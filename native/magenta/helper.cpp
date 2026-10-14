// Process-isolated MRT2 host. IPC: uint32 LE length, then 'J' JSON or 'P' PCM.
// PCM: D2M2, session:u32, generation:u32, sequence:u32, time:f64,
//      rate:u32=48000, frames:u32, then interleaved stereo float32.
#include <magentart/realtime_runner.h>
#include <magentart/detail/autorelease_pool.h>
#include <nlohmann/json.hpp>
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <deque>
#include <future>
#include <iostream>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <thread>
#include <unistd.h>
using Json=nlohmann::json;
using Clock=std::chrono::steady_clock;
using magentart::core::RealtimeRunner;
using magentart::core::MLXEngine;
constexpr size_t historyFrames=480000;
int outputFd;
uint32_t sessionId,generationId;
std::atomic<bool> alive{true};
std::mutex inboxMutex;
std::deque<Json> inbox;
std::vector<float> history(historyFrames*2);
size_t historyCount=0,historyHead=0;
double inputTimestamp=0;
uint32_t inputSequence=0;
double elapsed(Clock::time_point start){return std::chrono::duration<double,std::milli>(Clock::now()-start).count();}
bool readAll(int fd,void* data,size_t size){auto p=static_cast<char*>(data);while(size){auto n=read(fd,p,size);if(n<=0)return false;p+=n;size-=n;}return true;}
bool writeAll(int fd,const void* data,size_t size){auto p=static_cast<const char*>(data);while(size){auto n=write(fd,p,size);if(n<=0)return false;p+=n;size-=n;}return true;}
void send(char kind,const void* data,size_t size){uint32_t n=size+1;if(!writeAll(outputFd,&n,4)||!writeAll(outputFd,&kind,1)||!writeAll(outputFd,data,size))std::_Exit(0);}
void event(Json value){value["session"]=sessionId;value["generation"]=generationId;auto s=value.dump();send('J',s.data(),s.size());}
template<class T>T get(const std::vector<char>& data,size_t offset){T v;std::memcpy(&v,data.data()+offset,sizeof(v));return v;}
template<class T>void put(std::vector<char>& data,size_t offset,T value){std::memcpy(data.data()+offset,&value,sizeof(value));}

void readInput(){
  uint32_t size;
  while(readAll(STDIN_FILENO,&size,4)){
    if(size<2||size>1024*1024)break;
    std::vector<char> data(size);if(!readAll(STDIN_FILENO,data.data(),size))break;
    if(data[0]=='J'){
      auto j=Json::parse(data.begin()+1,data.end(),nullptr,false);
      if(j.is_discarded()||!j.is_object()||j.value("session",0u)!=sessionId||j.value("generation",0u)!=generationId)continue;
      std::lock_guard lock(inboxMutex);
      if(inbox.size()>=128){alive=false;return;} // reject rather than lose note-offs
      if(j.value("type","")=="weights")std::erase_if(inbox,[](const Json& p){return p.value("type","")=="weights";});
      inbox.push_back(std::move(j));
    }else if(data[0]=='P'){
      if(size<33||std::memcmp(data.data()+1,"D2M2",4))continue;
      auto frames=get<uint32_t>(data,29),seq=get<uint32_t>(data,13);
      auto time=get<double>(data,17);
      if(get<uint32_t>(data,5)!=sessionId||get<uint32_t>(data,9)!=generationId||get<uint32_t>(data,25)!=48000||frames>4800||size!=33+frames*8||!std::isfinite(time))continue;
      bool finite=true;for(size_t i=0;i<frames*2;i++)if(!std::isfinite(get<float>(data,33+i*4)))finite=false;
      if(!finite)continue;
      std::lock_guard lock(inboxMutex);
      if(seq<=inputSequence&&historyCount)continue;
      if(historyCount&&(seq!=inputSequence+1||time-inputTimestamp>200||time<inputTimestamp))historyCount=historyHead=0;
      inputSequence=seq;inputTimestamp=time;
      for(size_t i=0;i<frames;i++){
        history[historyHead*2]=get<float>(data,33+i*8);history[historyHead*2+1]=get<float>(data,37+i*8);
        historyHead=(historyHead+1)%historyFrames;historyCount=std::min(historyFrames,historyCount+1);
      }
    }
  }
  alive=false;
}

std::vector<float> snapshot(){
  std::lock_guard lock(inboxMutex);
  std::vector<float> pcm(historyCount*2);
  for(size_t i=0;i<historyCount;i++){
    auto j=(historyHead+historyFrames-historyCount+i)%historyFrames;
    pcm[i*2]=history[j*2];pcm[i*2+1]=history[j*2+1];
  }
  return pcm;
}
bool audible(const std::vector<float>& pcm){double energy=0;for(auto v:pcm)energy+=v*v;return !pcm.empty()&&energy/pcm.size()>1e-8;}
std::vector<float> reference(const std::vector<float>& pcm){
  std::vector<float> mono(160000); // anti-alias low pass, 48 -> 16 kHz
  static const auto kernel=[](){std::array<double,97> values{};double norm=0;
    for(int k=-48;k<=48;k++){double x=k/3.;values[k+48]=(k==0?1:std::sin(M_PI*x)/(M_PI*x))*(.5+.5*std::cos(M_PI*k/48));norm+=values[k+48];}
    for(auto& value:values)value/=norm;return values;}();
  for(size_t i=0;i<mono.size();i++){
    double value=0;
    for(int k=-48;k<=48;k++){
      auto j=static_cast<int>(i*3)+k;
      if(j>=0&&j<static_cast<int>(pcm.size()/2))value+=(pcm[j*2]+pcm[j*2+1])*.5*kernel[k+48];
    }
    mono[i]=value;
  }
  return mono;
}
struct Job{int slot;std::string text;int revision=0;std::vector<float> samples;Clock::time_point started;bool submitted=false;};

int main(int argc,char** argv){
  if(argc!=5)return 2;
  outputFd=dup(STDOUT_FILENO);dup2(STDERR_FILENO,STDOUT_FILENO);
  sessionId=std::stoul(argv[3]);generationId=std::stoul(argv[4]);
  // Process lifetime owns cancellation of upstream's detached encoder thread.
  // EOF/Stop or server termination frees all models through process exit.
  try{
    std::string root=argv[1],model=argv[2];
    if(model!="base"&&model!="small")throw std::runtime_error("Invalid model");
    std::thread(readInput).detach();
    magentart::detail::AutoreleasePool pool;
    auto& runner=*new RealtimeRunner();auto& encoder=*new MLXEngine();
    event({{"type","status"},{"state","loading"},{"message","Loading MRT2 "+model}});
    if(!runner.init_assets((root+"/resources").c_str())||!encoder.init_assets((root+"/resources").c_str()))throw std::runtime_error("MusicCoCa assets failed to load");
    if(!runner.load_model((root+"/models/mrt2_"+model+"/mrt2_"+model+".mlxfn").c_str()))throw std::runtime_error("MRT2 model failed to load");
    if(!runner.load_prefill_model((root+"/resources/spectrostream/spectrostream_encoder.mlxfn").c_str(),nullptr))throw std::runtime_error("SpectroStream failed to load");
    runner.set_buffer_size(5760);runner.set_midi_gate_enabled(false);runner.set_onset_mode(1);
    std::array<std::optional<Job>,3> pending;
    std::optional<Job> job;
    std::future<std::vector<float>> audioPreparation;
    std::optional<std::vector<float>> pendingAudio;
    std::array<float,4> weights{1.f/3,1.f/3,1.f/3,0};
    std::array<bool,3> valid{};
    std::optional<Json> weightAck;uint32_t weightTarget=0;
    bool audioValid=false,ready=false;
    std::string mode="audio-notes";float influence=.35;
    auto blend=[&]{float combined[4];for(int i=0;i<3;i++)combined[i]=weights[i]*(audioValid&&mode!="continue"?1-influence:1);combined[3]=audioValid&&mode!="continue"?influence:0;runner.set_blend_weights(combined,4);};
    auto release=[&]{for(int n=0;n<128;n++)runner.set_note_off(n);};
    auto nextAudio=Clock::now(),nextOutput=Clock::now(),nextStatus=Clock::now();
    uint32_t outputSeq=0;auto epoch=Clock::now();
    std::array<float,960> left{},right{};
    while(alive){
      std::deque<Json> commands;
      {std::lock_guard lock(inboxMutex);commands.swap(inbox);}
      for(auto& c:commands){
        auto type=c.value("type","");
        if(type=="stop")std::_Exit(0);
        if(type=="prompt"){
          int i=c.at("index"),revision=c.at("revision");std::string text=c.at("text");
          if(i<0||i>2||text.empty()||text.size()>1024)throw std::runtime_error("Invalid prompt");
          pending[i]=Job{i,text,revision};
          event({{"type","prompt"},{"index",i},{"revision",revision},{"state","encoding"}});
        }else if(type=="weights"){
          auto values=c.at("weights").get<std::vector<float>>();float sum=0;
          if(values.size()!=3)throw std::runtime_error("Invalid weights");
          for(auto w:values){if(!std::isfinite(w)||w<0||w>1)throw std::runtime_error("Invalid weight");sum+=w;}
          if(sum>0)for(int i=0;i<3;i++)weights[i]=values[i]/sum;
          blend();weightTarget=runner.blend_generation();
          weightAck=Json{{"type","weights-applied"},{"weights",weights},{"timestamp",c.value("timestamp",0.)}};
        }else if(type=="input"){
          auto next=c.at("mode").get<std::string>();
          if(next!="audio-notes"&&next!="audio"&&next!="continue")throw std::runtime_error("Invalid input mode");
          release();mode=next;pendingAudio.reset();runner.set_cfg_notes(mode=="audio-notes"?5:0);
          influence=std::clamp(c.value("influence",.35f),0.f,1.f);blend();
        }else if(type=="note"){
          int note=c.at("note");if(note<0||note>127)throw std::runtime_error("Invalid note");
          if(mode=="audio-notes"){if(c.value("on",false))runner.set_note_on(note);else runner.set_note_off(note);}
        }else if(type=="influence"){
          influence=std::clamp(c.value("value",.35f),0.f,1.f);blend();
        }else if(type=="release")release();
        else if(type=="reset-input"){
          release();std::lock_guard lock(inboxMutex);historyCount=historyHead=0;pendingAudio.reset();audioValid=false;blend();
        }else if(type=="capture"&&mode=="continue"&&ready){
          auto pcm=snapshot();
          if(pcm.size()<48000*2*4||!audible(pcm)){event({{"type","capture"},{"state","error"},{"message","Need at least four seconds of audible body music"}});continue;}
          release();event({{"type","capture"},{"state","processing"}});
          auto tick=Clock::now();
          bool ok=runner.prefill_state(pcm.data(),pcm.size()/2);
          if(!ok)throw std::runtime_error("Phrase continuation failed");
          event({{"type","flush"}});nextOutput=Clock::now();
          event({{"type","capture"},{"state","complete"},{"latency_ms",elapsed(tick)}});
        }
      }
      if(job&&job->slot==3&&!job->submitted&&audioPreparation.valid()&&audioPreparation.wait_for(std::chrono::seconds(0))==std::future_status::ready){
        job->samples=audioPreparation.get();
        encoder.set_audio_prompt_samples(3,"body audio",job->samples.data(),job->samples.size());job->submitted=true;
      }
      if(job&&job->submitted&&!encoder.is_prompt_encoding()){
        float embedding[768];bool ok=encoder.get_quantizer_status()==2&&encoder.get_prompt_embedding(job->slot==3?3:0,embedding);
        bool superseded=job->slot<3&&pending[job->slot]&&pending[job->slot]->revision>job->revision;
        if(ok&&!superseded){runner.set_audio_embedding(job->slot,embedding);if(job->slot<3)valid[job->slot]=true;else audioValid=true;blend();}
        event({{"type",job->slot==3?"audio-reference":"prompt"},{"index",job->slot},{"revision",job->revision},{"state",ok?"ready":"error"},{"latency_ms",elapsed(job->started)}});
        job.reset();encoder.get_logs();
      }
      if(ready&&mode!="continue"&&Clock::now()>=nextAudio){
        nextAudio=Clock::now()+std::chrono::seconds(2);
        auto pcm=snapshot();if(pcm.size()==historyFrames*2&&audible(pcm))pendingAudio=std::move(pcm);
      }
      if(!job){
        for(auto& p:pending)if(p){job=std::move(p);p.reset();break;}
        if(job){
          encoder.set_audio_embedding(3,nullptr);job->started=Clock::now();
          encoder.set_text_prompts({job->text,"","",""},{1,0,0,0});
          job->submitted=true;
        }else if(pendingAudio&&mode!="continue"){
          job=Job{3,"body audio",0,{},Clock::now()};
          audioPreparation=std::async(std::launch::async,[pcm=std::move(*pendingAudio)]{return reference(pcm);});pendingAudio.reset();
          event({{"type","audio-reference"},{"state","encoding"}});
        }
      }
      if(!ready&&std::all_of(valid.begin(),valid.end(),[](bool v){return v;})){
        blend();runner.reset();ready=true;nextOutput=Clock::now();
        event({{"type","status"},{"state","ready"},{"model",model},{"message","MRT2 "+model+" ready"}});
      }
      if(weightAck&&runner.applied_blend_generation()>=weightTarget){event(*weightAck);weightAck.reset();}
      if(ready&&Clock::now()>=nextOutput){
        auto now=Clock::now();
        if(elapsed(nextOutput)>100)runner.reset_for_playback();
        if(elapsed(nextOutput)>100)nextOutput=now;
        nextOutput+=std::chrono::milliseconds(20);
        bool ok=runner.read_audio_stereo(left.data(),right.data(),960);
        std::vector<char> packet(32+960*8);std::memcpy(packet.data(),"D2M2",4);
        put(packet,4,sessionId);put(packet,8,generationId);put(packet,12,++outputSeq);put(packet,16,elapsed(epoch));put(packet,24,uint32_t(48000));put(packet,28,uint32_t(960));
        for(int i=0;i<960;i++){put(packet,32+i*8,left[i]);put(packet,36+i*8,right[i]);}
        send('P',packet.data(),packet.size());
        if(!ok)event({{"type","underrun"}});
      }
      if(Clock::now()>=nextStatus){
        nextStatus=Clock::now()+std::chrono::seconds(1);
        auto m=runner.get_metrics();auto pcm=snapshot();
        event({{"type","metrics"},{"frame_ms",m.total_ms},{"underruns",m.dropped_frames},{"history_s",pcm.size()/96000.},{"capture_ready",pcm.size()>=384000&&audible(pcm)}});
        runner.get_logs();
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    release();std::_Exit(0);
  }catch(const std::exception& e){event({{"type","error"},{"message",e.what()}});std::_Exit(1);}
}
