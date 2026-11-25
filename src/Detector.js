// Hidden WebView that runs MobileNet v2 (TensorFlow.js) on the phone to check
// whether a photo shows an animal. Nothing is uploaded for this check.
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

const HTML = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width">
<script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js"></script></head><body><script>
let model=null, loading=null;
function send(o){ window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
function load(){
  // CPU backend: phone GPUs (WebGL, 16-bit floats) gave wrong answers, e.g. a dog read as a turtle.
  if(!loading){ loading = tf.setBackend("cpu").then(()=>tf.ready()).then(()=>tf.loadGraphModel("https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_100_224/classification/3/default/1",{fromTFHub:true})).then(m=>model=m).catch(e=>{loading=null; throw e;}); }
  return loading;
}
// A gold (Pet of the Month) or pink-orange frame painted onto the photo with another app = fake award.
function fakeFrame(img){
  try{
    const W=160, H=Math.max(8,Math.round(160*img.height/img.width));
    const c=document.createElement("canvas"); c.width=W; c.height=H;
    const x=c.getContext("2d"); x.drawImage(img,0,0,W,H); const d=x.getImageData(0,0,W,H).data;
    const s=Math.max(3,Math.round(Math.min(W,H)*0.05));
    const side=(x0,y0,x1,y1)=>{let n=0,r=0,g=0,b=0,q=0;for(let y=y0;y<y1;y++)for(let xx=x0;xx<x1;xx++){const i=(y*W+xx)*4;const R=d[i],G=d[i+1],B=d[i+2];r+=R;g+=G;b+=B;q+=R*R+G*G+B*B;n++;}
      r/=n;g/=n;b/=n;const sd=Math.sqrt(Math.max(0,(q/n-(r*r+g*g+b*b))/3));return {r,g,b,sd};};
    const S=[side(0,0,W,s),side(0,H-s,W,H),side(0,0,s,H),side(W-s,0,W,H)];
    const gold=S.every(o=>o.sd<40&&o.r>170&&o.g>110&&o.g<225&&o.b<130&&o.r-o.b>70);
    const brand=S.every(o=>o.sd<40&&o.r>200&&o.g>50&&o.g<170&&o.b<150&&o.r-o.g>60);
    return gold||brand;
  }catch(e){ return false; }
}
async function classify(id, b64){
  try{
    await load();
    const img=new Image();
    img.onload=()=>{
      try{
        const probs=tf.tidy(()=>{const t=tf.browser.fromPixels(img).resizeBilinear([224,224]).toFloat().div(255).expandDims(0);return tf.softmax(model.predict(t)).dataSync();});
        let animalSum=0,best=-1,bestP=0,top=-1,topP=0;
        for(let k=1;k<probs.length;k++){const p=probs[k]; if(p>topP){topP=p;top=k;} if(k<=398){animalSum+=p; if(p>bestP){bestP=p;best=k;}}}
        // Strict: the single most likely thing must be an animal AND animals must cover at least half of the guess.
        const animal = top>=1 && top<=398 && animalSum>=0.5;
        send({id, ok:true, animal, cls:(animal?best:top)-1, conf:animal?Math.min(animalSum,.999):topP, animalSum, frame:fakeFrame(img)});
      }catch(e){ send({id, ok:false, error:String(e)}); }
    };
    img.onerror=()=>send({id, ok:false, error:"image"});
    img.src="data:image/jpeg;base64,"+b64;
  }catch(e){ send({id, ok:false, error:String(e)}); }
}
document.addEventListener("message", e=>{ const d=JSON.parse(e.data); classify(d.id,d.b64); });
window.addEventListener("message", e=>{ const d=JSON.parse(e.data); classify(d.id,d.b64); });
setTimeout(()=>load().then(()=>send({ready:true})).catch(e=>send({ready:false,error:String(e)})),300);
</script></body></html>`;

const Detector = forwardRef((props, ref) => {
  const web = useRef(null);
  const pending = useRef({});
  useImperativeHandle(ref, () => ({
    detect(b64) {
      return new Promise((resolve, reject) => {
        const id = String(Date.now() + Math.random());
        const timer = setTimeout(() => { delete pending.current[id]; reject(new Error('timeout')); }, 45000);
        pending.current[id] = (r) => { clearTimeout(timer); resolve(r); };
        web.current?.postMessage(JSON.stringify({ id, b64 }));
      });
    },
  }));
  return (
    <View style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }} pointerEvents="none">
      <WebView
        ref={web}
        originWhitelist={['*']}
        source={{ html: HTML, baseUrl: 'https://getpawsapp.com' }}
        javaScriptEnabled
        onMessage={(e) => {
          try {
            const d = JSON.parse(e.nativeEvent.data);
            if (d.id && pending.current[d.id]) { pending.current[d.id](d); delete pending.current[d.id]; }
          } catch (err) {}
        }}
      />
    </View>
  );
});
export default Detector;
