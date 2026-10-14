// Real-model proof gate: no fallback synthesizer or placeholder embeddings.
#include <magentart/mlx_engine.h>
#include <magentart/detail/autorelease_pool.h>
#include <array>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <thread>

using magentart::core::MLXEngine;
using Clock = std::chrono::steady_clock;
constexpr int frame = 1920;

void require(bool ok, const char* message) {
  if (!ok) throw std::runtime_error(message);
}

double ms(Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

void encoded(MLXEngine& engine) {
  auto start = Clock::now();
  while (ms(start) < 120000) {
    if (engine.get_text_encoder_status() == 3 || engine.get_quantizer_status() == 3)
      throw std::runtime_error("MusicCoCa encoding failed");
    if (engine.get_text_encoder_status() == 2 && engine.get_quantizer_status() == 2) return;
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  throw std::runtime_error("MusicCoCa encoding timed out");
}

// Read actual, user-supplied stereo float PCM (48 kHz, 4–10 seconds).
std::vector<float> phrase(const std::filesystem::path& path) {
  auto bytes = std::filesystem::file_size(path);
  require(bytes % 8 == 0 && bytes >= 4 * 48000 * 8 && bytes <= 10 * 48000 * 8,
          "Input must be 4–10 seconds of stereo float32 PCM at 48 kHz");
  std::vector<float> pcm(bytes / 4);
  std::ifstream in(path, std::ios::binary);
  in.read(reinterpret_cast<char*>(pcm.data()), bytes);
  require(bool(in), "Cannot read phrase PCM");
  double energy = 0;
  for (auto v : pcm) { require(std::isfinite(v), "Nonfinite input PCM"); energy += v * v; }
  require(energy / pcm.size() > 1e-8, "Silent input PCM");
  return pcm;
}

// 48 -> 16 kHz: windowed-sinc low pass before downsampling. Ten-second window.
std::vector<float> reference(const std::vector<float>& pcm) {
  constexpr int radius = 48;
  std::vector<float> mono(160000, 0);
  int frames = pcm.size() / 2;
  int offset = mono.size() - frames / 3;
  for (int i = 0; i < frames / 3; ++i) {
    double value = 0, norm = 0;
    for (int k = -radius; k <= radius; ++k) {
      double x = k / 3.0;
      double w = (k == 0 ? 1 : std::sin(M_PI * x) / (M_PI * x))
                 * (0.5 + 0.5 * std::cos(M_PI * k / radius));
      int j = i * 3 + k;
      if (j >= 0 && j < frames) value += 0.5 * (pcm[2*j] + pcm[2*j+1]) * w;
      norm += w;
    }
    mono[offset+i] = value / norm;
  }
  return mono;
}

std::vector<float> render(MLXEngine& engine, const std::filesystem::path& path, int frames) {
  std::vector<float> output;
  output.reserve(frames * frame * 2);
  std::array<float, frame> left{}, right{};
  auto start = Clock::now();
  double maxFrame = 0;
  for (int f = 0; f < frames; ++f) {
    magentart::detail::AutoreleasePool pool;
    auto tick = Clock::now();
    require(engine.generate_frame(left.data(), right.data()), "Native generation failed");
    maxFrame = std::max(maxFrame, ms(tick));
    for (int s = 0; s < frame; ++s) {
      require(std::isfinite(left[s]) && std::isfinite(right[s]), "Nonfinite model output");
      output.push_back(left[s]); output.push_back(right[s]);
    }
  }
  double energy = 0;
  for (auto v : output) energy += v * v;
  require(energy / output.size() > 1e-10, "Silent model output");
  std::ofstream file(path, std::ios::binary);
  file.write(reinterpret_cast<const char*>(output.data()), output.size() * sizeof(float));
  require(bool(file), "Cannot save model output");
  std::cout << "METRIC " << path.filename().string() << " generation_ms=" << ms(start)
            << " max_frame_ms=" << maxFrame << " audio_ms=" << frames * 40
            << " rms=" << std::sqrt(energy/output.size()) << std::endl;
  return output;
}

void differs(const std::vector<float>& a, const std::vector<float>& b, const char* message) {
  require(a.size() == b.size(), "Comparison shape mismatch");
  double error = 0;
  for (size_t i = 0; i < a.size(); ++i) error += std::abs(a[i] - b[i]);
  require(error / a.size() > 1e-5, message);
}

int main(int argc, char** argv) {
  if (argc != 6) {
    std::cerr << "Usage: mrt2_probe ASSET_ROOT base|small PHRASE_A.f32 PHRASE_B.f32 OUTPUT_DIR\n";
    return 2;
  }
  try {
    magentart::detail::AutoreleasePool pool;
    const std::filesystem::path root(argv[1]), out(argv[5]);
    const std::string name = std::string("mrt2_") + argv[2];
    require(name == "mrt2_small" || name == "mrt2_base", "Invalid model");
    std::filesystem::create_directories(out);
    auto a = phrase(argv[3]), b = phrase(argv[4]);
    // Upstream encodes on a detached thread; process exit owns error cleanup.
    auto& engine = *new MLXEngine();
    require(engine.init_assets((root / "resources").c_str(), "musiccoca"), "Cannot load MusicCoCa");
    require(engine.load_model((root / "models" / name / (name + ".mlxfn")).c_str()), "Cannot load MRT2");
    require(engine.load_prefill_model((root / "resources/spectrostream/spectrostream_encoder.mlxfn").c_str(), nullptr), "Cannot load SpectroStream");
    engine.set_seed_rotation(42);
    engine.set_onset_mode(1);
    engine.set_text_prompts({"warm electric piano", "rounded funk bass", "brushed percussion", ""}, {1,0,0,0});
    encoded(engine);
    engine.reset_to_factory();
    auto textA = render(engine, out / "text-piano.f32", 100);
    float bass[] = {0,1,0,0};
    auto weightsStart = Clock::now();
    require(engine.reblend_musiccoca_tokens(bass, 4), "Cannot blend cached prompts");
    std::cout << "METRIC cached_weights_ms=" << ms(weightsStart) << std::endl;
    engine.reset_to_factory();
    auto textB = render(engine, out / "text-bass.f32", 100);
    differs(textA, textB, "Text blend did not change output");
    engine.reset_to_factory();
    auto repeated = render(engine, out / "text-bass-repeat.f32", 100);
    double repeatError = 0;
    for (size_t i=0; i<repeated.size(); ++i) repeatError += std::abs(repeated[i]-textB[i]);
    require(repeatError/repeated.size() < 1e-6, "Deterministic control failed; cannot attribute output differences to conditioning");
    engine.set_cfg_notes(2);
    engine.reset_to_factory();
    auto noNotes = render(engine, out / "notes-control.f32", 100);
    engine.set_note_on(60); engine.set_note_on(64); engine.set_note_on(67);
    engine.reset_to_factory();
    auto notes = render(engine, out / "notes.f32", 100);
    for (int n=0; n<128; ++n) engine.set_note_off(n);
    engine.set_cfg_notes(0);
    differs(noNotes, notes, "Note steering did not change output");
    std::vector<float> embeds[2], rendered[2];
    for (int i=0; i<2; ++i) {
      auto mono = reference(i ? b : a);
      auto tick = Clock::now();
      engine.set_audio_prompt_samples(3, i ? "phrase-b" : "phrase-a", mono.data(), mono.size());
      encoded(engine);
      require(engine.get_prompt_status(3) == 2, "Audio reference encoding failed");
      embeds[i].resize(768);
      require(engine.get_audio_embedding(3, embeds[i].data()), "No real audio embedding");
      std::cout << "METRIC audio_reference_ms=" << ms(tick) << std::endl;
      float audioWeights[] = {0.21666667f,0.21666667f,0.21666667f,0.35f};
      require(engine.reblend_musiccoca_tokens(audioWeights,4), "Audio blend failed");
      engine.reset_to_factory();
      rendered[i] = render(engine, out / (i ? "audio-b.f32" : "audio-a.f32"), 100);
    }
    differs(embeds[0], embeds[1], "Audio embedding is independent of supplied samples");
    differs(rendered[0], rendered[1], "Generation is independent of audio reference");
    engine.set_audio_embedding(3, nullptr);
    float textWeights[] = {1.0f/3,1.0f/3,1.0f/3,0};
    require(engine.reblend_musiccoca_tokens(textWeights,4), "Text reblend failed");
    std::vector<float> continued[2];
    for (int i=0; i<2; ++i) {
      engine.reset_to_factory();
      auto& pcm = i ? b : a;
      auto tick = Clock::now();
      require(engine.prefill_state(pcm.data(), pcm.size()/2, 25, 25), "Captured-phrase prefill failed");
      std::cout << "METRIC phrase_preparation_ms=" << ms(tick) << std::endl;
      continued[i] = render(engine, out / (i ? "continue-b.f32" : "continue-a.f32"), 100);
    }
    differs(continued[0], continued[1], "Continuation is independent of captured phrase");
    std::cout << "PASS native text, cached blend, notes, sample audio, and phrase continuation" << std::endl;
    std::_Exit(0);
  } catch (const std::exception& e) {
    std::cerr << "FAIL native proof gate: " << e.what() << std::endl;
    // The pinned upstream encoder uses detached threads. On an error, process
    // exit owns cancellation; do not destroy a possibly busy engine in place.
    std::_Exit(1);
  }
}
