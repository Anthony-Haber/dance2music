// MediaPipe 1.0.1 reads GPU masks as RED/FLOAT. ANGLE/Metal can reject that
// combination and silently return zeros. Convert to RGBA8 on the same GPU,
// downsample there, and read the universally supported RGBA/UNSIGNED_BYTE pair.
// All MediaPipe GL state touched here is restored before its callback returns.
export class PersonMaskReader {
  read(mask,width=160) {
    const height=Math.max(32,Math.round(width*mask.height/mask.width));
    if(!mask.hasWebGLTexture?.()) {
      const src=mask.getAsFloat32Array(),data=new Float32Array(width*height);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++)data[y*width+x]=src[Math.min(mask.height-1,Math.floor(y*mask.height/height))*mask.width+Math.min(mask.width-1,Math.floor(x*mask.width/width))];
      return {width,height,data};
    }
    const gl=mask.canvas?.getContext('webgl2');
    if(!gl||gl.isContextLost())throw new Error('Person mask GPU unavailable');
    if(this.gl!==gl){this.dispose();this.gl=gl;}
    const state={draw:gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),read:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),
      program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),viewport:gl.getParameter(gl.VIEWPORT),
      active:gl.getParameter(gl.ACTIVE_TEXTURE),color:gl.getParameter(gl.COLOR_WRITEMASK),pack:gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),
      pixel:[gl.PACK_ALIGNMENT,gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS].map(p=>[p,gl.getParameter(p)]),
      flags:[gl.BLEND,gl.DEPTH_TEST,gl.SCISSOR_TEST,gl.CULL_FACE,gl.RASTERIZER_DISCARD,gl.DITHER].map(p=>[p,gl.isEnabled(p)])};
    gl.activeTexture(gl.TEXTURE0);state.texture=gl.getParameter(gl.TEXTURE_BINDING_2D);state.sampler=gl.getParameter(gl.SAMPLER_BINDING);
    try {
      if(!this.program)this.initialize(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);
      gl.bindTexture(gl.TEXTURE_2D,this.texture);
      if(this.width!==width||this.height!==height){
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        this.width=width;this.height=height;this.bytes=new Uint8Array(width*height*4);
      }
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Person mask framebuffer unavailable');
      gl.viewport(0,0,width,height);state.flags.forEach(([p])=>gl.disable(p));gl.colorMask(true,true,true,true);
      gl.useProgram(this.program);gl.bindVertexArray(this.vao);gl.bindSampler(0,null);
      gl.bindTexture(gl.TEXTURE_2D,mask.getAsWebGLTexture());gl.uniform1i(this.input,0);
      gl.drawArrays(gl.TRIANGLES,0,3);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
      for(const p of [gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS])gl.pixelStorei(p,0);
      gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,this.bytes);
      const data=new Float32Array(width*height);for(let i=0;i<data.length;i++)data[i]=this.bytes[i*4]/255;
      return {width,height,data};
    } finally {
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,state.draw);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,state.read);
      gl.useProgram(state.program);gl.bindVertexArray(state.vao);gl.viewport(...state.viewport);gl.colorMask(...state.color);
      state.flags.forEach(([p,on])=>on?gl.enable(p):gl.disable(p));
      gl.bindTexture(gl.TEXTURE_2D,state.texture);gl.bindSampler(0,state.sampler);gl.activeTexture(state.active);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER,state.pack);state.pixel.forEach(([p,value])=>gl.pixelStorei(p,value));
    }
  }
  initialize(gl) {
    const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(error);}return s;};
    const vertex=shader(gl.VERTEX_SHADER,'#version 300 es\nout vec2 uv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}');
    const fragment=shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;uniform sampler2D inputMask;in vec2 uv;out vec4 color;void main(){ivec2 size=textureSize(inputMask,0);float p=texelFetch(inputMask,clamp(ivec2(uv*vec2(size)),ivec2(0),size-1),0).r;color=vec4(p,0.,0.,1.);}');
    this.program=gl.createProgram();gl.attachShader(this.program,vertex);gl.attachShader(this.program,fragment);gl.linkProgram(this.program);
    gl.deleteShader(vertex);gl.deleteShader(fragment);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program));
    this.input=gl.getUniformLocation(this.program,'inputMask');this.vao=gl.createVertexArray();this.framebuffer=gl.createFramebuffer();this.texture=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  }
  dispose(){if(this.gl){this.gl.deleteTexture(this.texture);this.gl.deleteFramebuffer(this.framebuffer);this.gl.deleteVertexArray(this.vao);this.gl.deleteProgram(this.program);}
    this.gl=null;this.program=null;this.texture=null;this.framebuffer=null;this.vao=null;this.width=0;this.height=0;this.bytes=null;}
}
