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
  if(!loading){ loading = tf.loadGraphModel("https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_100_224/classification/3/default/1",{fromTFHub:true}).then(m=>model=m); }
  return loading;
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
        const animal=animalSum>=0.35||bestP>=0.15;
        send({id, ok:true, animal, cls:(animal?best:top)-1, conf:animal?Math.max(bestP,Math.min(animalSum,.99)):topP});
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
