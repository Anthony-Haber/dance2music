// Moving pixels are suppressed individually. Confident person pixels retain
// real depth ordering, including when the person is behind an object.
export function compositingDepth(latest,person,pixels,now,out=new Float32Array(latest.inverse.length)) {
  const {width:w,height:h,inverse,rgb}=latest;
  out.set(inverse);
  const mask=(p,x,y)=>p?.data[Math.min(p.height-1,Math.floor((y+.5)*p.height/h))*p.width+Math.min(p.width-1,Math.floor((x+.5)*p.width/w))]??0;
  const fresh=person&&now-person.timestamp<150;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const i=y*w+x,old=mask(latest.person,x,y),current=fresh?mask(person,x,y):old;
    const grey=pixels?.length? .299*pixels[i*4]+.587*pixels[i*4+1]+.114*pixels[i*4+2]:rgb[i];
    if((old>.15&&old<.85)||(current>.15&&current<.85)||Math.abs(grey-rgb[i])>35||((old>.2)!==(current>.2))) {
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h)out[(y+dy)*w+x+dx]=0;
    }
  }
  return out;
}
