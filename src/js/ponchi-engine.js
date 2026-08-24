/**
 * ponchi-engine.js — カルテ画面の描画エンジン
 *
 * `ponchi-v2.html` のインライン <script> から逐語で切り出したもの（統合 plan の P0）。
 * 中身は一切変えていない。位置だけを変えた。
 *
 * なぜ切り出したか:
 *   このエンジンは `src/js/*.js` には無く、HTML のインラインにだけ存在していた。
 *   つまり **HTML を差し替えるとエンジンごと消える**。統合フェーズ（P1 以降）は
 *   HTML/CSS をモック意匠へ貼り替える作業なので、先にここを外へ出しておかないと
 *   貼り替えた瞬間に描画・体重グラフ・写真・音声入力が全部無くなる。
 *
 * 含まれるもの:
 *   - createToolbarHTML()  ツールバー HTML の生成（5箇所で共用）
 *   - ヒーロー / カルーセルの横スクロール制御
 *   - ヒーロー日付の native ピッカー ⇄ 表示 span 同期（__SALTYDOG_HERODATE_FROM_SPANS）
 *   - 体重グラフ（__SALTYDOG_GET_WEIGHTS / __SALTYDOG_SET_WEIGHTS）
 *   - createDrawer() — Konva の描画エンジン本体
 *   - 犬体図 / 歯 / トリミングチェックの各インスタンス（__SALTYDOG_BM / TEETH / TC / TCN）
 *   - 写真への描き込み、判定 UI、音声入力
 *
 * 読み込み順の制約:
 *   konva.min.js → **このファイル** → ponchi-app.js → publish-client-ponchi.js
 *   すべて classic script（defer なし）で、HTML 内の記述順に実行される。
 *   このファイルは DOM を直接参照するので、body の末尾より前に置かない。
 */

// ── ツールバー HTML ビルダー（5箇所の重複を1関数に集約） ──
function createToolbarHTML(idPrefix, opts) {
  var o = opts || {};
  var isPhoto = !!o.isPhoto;
  var safeKey = o.safeKey || '';
  var withTitle = !isPhoto;
  function tb(tool, icon, titleText) {
    var cls = 'bm-tool-btn' + (tool === 'pen' ? ' active' : '');
    var dt = ' data-tool="' + tool + '"';
    var title = withTitle && titleText ? ' title="' + titleText + '"' : '';
    return '<button type="button" class="' + cls + '"' + dt + title + '>' + icon + '</button>';
  }
  function cswatch(color, hex, titleText, extraStyle) {
    var cls = 'bm-color-swatch' + (color === '#e85c5c' ? ' active' : '');
    var title = withTitle && titleText ? ' title="' + titleText + '"' : '';
    return '<button type="button" class="' + cls + '" data-color="' + color + '" style="background:' + hex + (extraStyle || '') + '"' + title + '></button>';
  }
  var doneId = isPhoto ? ' id="pd-done-' + safeKey + '"' : ' id="' + idPrefix + '-done-btn"';
  var doneTitle = withTitle ? ' title="描画完了"' : '';
  var done = '<button type="button" class="bm-tool-btn bm-done-btn"' + doneId + doneTitle + '>✓完了</button>';
  var colSpanId = isPhoto ? '' : ' id="' + idPrefix + '-colors"';
  var whiteHex = isPhoto ? '#fff' : '#ffffff';
  var whiteExtra = isPhoto ? ';border:1.5px solid #ccc' : '';
  var colors = '<span class="bm-colors"' + colSpanId + '>' +
    cswatch('#e85c5c','#e85c5c','赤') +
    cswatch('#4a90e2','#4a90e2','青') +
    cswatch('#3aaf5c','#3aaf5c','緑') +
    cswatch('#222222','#222222','黒') +
    cswatch('#ffffff', whiteHex, withTitle ? '白' : null, whiteExtra) +
    '</span>';
  var pen    = tb('pen',    '✏️', 'ペン');
  var arrow  = tb('arrow',  '↗',  '矢印');
  var text   = tb('text',   'T',  '文字');
  var eraser = tb('eraser', '🧽', '消しゴム');
  var undo   = tb('undo',   '↶',  '取消');
  var stamp  = tb('stamp',  '🔖', 'スタンプ');
  // Photo版: stamp→colors の順。静的版: colors→stamp の順（元のHTML順を保持）
  if (isPhoto) { return pen + arrow + text + eraser + undo + stamp + colors + done; }
  return pen + arrow + text + eraser + undo + colors + stamp + done;
}
// 静的ツールバー4箇所を createToolbarHTML で上書き
['tc','tcn','bm','tt'].forEach(function(p){
  var el = document.getElementById(p+'-toolbar');
  if(el) el.innerHTML = createToolbarHTML(p, {});
});

// ── ヒーロー（中央停止・ページ縦スクロール防止・dot同期） ──
(function(){var t=document.getElementById('heroTrack');if(!t)return;var slides=t.querySelectorAll('.hero-slide');var d=document.querySelectorAll('.hero-dots .hd');function to(i){var slide=slides[i];var target=slide.offsetLeft-(t.clientWidth-slide.offsetWidth)/2;t.scrollTo({left:Math.max(0,target),behavior:'smooth'});}function syncDots(){var closest=0,minDist=Infinity;slides.forEach(function(slide,i){var dist=Math.abs(slide.offsetLeft-(t.clientWidth-slide.offsetWidth)/2-t.scrollLeft);if(dist<minDist){minDist=dist;closest=i;}});d.forEach(function(x,n){x.classList.toggle('on',n===closest);});}t.addEventListener('scrollend',syncDots,{passive:true});d.forEach(function(dot,i){dot.style.cursor='pointer';dot.addEventListener('click',function(){to(i);});});})();

// ── ヒーロー日付（native date ピッカー ⇄ 表示 span 同期） ──
(function(){
  var input=document.getElementById('heroDateInput');
  if(!input)return;
  var yEl=document.querySelector('.hero-date-pick [data-field="year"]');
  var mEl=document.querySelector('.hero-date-pick [data-field="date"]');
  var dEl=document.querySelector('.hero-date-pick [data-field="day"]');
  function pad(n){n=String(n);return n.length<2?'0'+n:n;}
  function fromInput(){
    var m=(input.value||'').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m)return;
    if(yEl)yEl.textContent=m[1];
    if(mEl)mEl.textContent=String(Number(m[2]));
    if(dEl)dEl.textContent=String(Number(m[3]));
  }
  function fromSpans(){
    var y=(yEl&&yEl.textContent.trim())||'';
    var mo=(mEl&&mEl.textContent.trim())||'';
    var d=(dEl&&dEl.textContent.trim())||'';
    if(/^\d{4}$/.test(y)&&/^\d{1,2}$/.test(mo)){
      input.value=y+'-'+pad(mo)+'-'+(/^\d{1,2}$/.test(d)?pad(d):'01');
    }
  }
  input.addEventListener('change',fromInput);
  input.addEventListener('input',fromInput);
  /* タップで OS カレンダーを開く（透明 input がタップで開かない端末対策・date input のみに影響） */
  input.addEventListener('click',function(){
    if(typeof input.showPicker==='function'){try{input.showPicker();}catch(_e){/* showPicker未対応端末: 既定UIにフォールバックするため無視 */}}
  });
  fromSpans(); /* 静的初期値から input を構築。applyReport 後は下記 API で再構築 */
  window.__SALTYDOG_HERODATE_FROM_SPANS=fromSpans;
})();

// ── カルーセル（中央停止・ページ縦スクロール防止） ──
(function(){var c=document.getElementById('bodyCar');if(!c)return;var cards=c.querySelectorAll('.card');if(!cards.length)return;var idx=0,paused=false;function to(i){idx=(i+cards.length)%cards.length;var card=cards[idx];var target=card.offsetLeft-(c.clientWidth-card.offsetWidth)/2;c.scrollTo({left:Math.max(0,target),behavior:'smooth'});}
c.addEventListener('scrollend',function(){var closest=0,minDist=Infinity;cards.forEach(function(card,i){var dist=Math.abs(card.offsetLeft-(c.clientWidth-card.offsetWidth)/2-c.scrollLeft);if(dist<minDist){minDist=dist;closest=i;}});idx=closest;},{passive:true});var w=c.closest('.car-wrap');w.querySelector('.car-next').addEventListener('click',function(){to(idx+1);});w.querySelector('.car-prev').addEventListener('click',function(){to(idx-1);});['mouseenter','touchstart','pointerdown'].forEach(function(e){w.addEventListener(e,function(){paused=true;},{passive:true});});['mouseleave','touchend'].forEach(function(e){w.addEventListener(e,function(){paused=false;},{passive:true});});var _iv=setInterval(function(){if(!paused)to(idx+1);},2800);document.addEventListener('visibilitychange',function(){if(document.hidden){clearInterval(_iv);}else{_iv=setInterval(function(){if(!paused)to(idx+1);},2800);}});})();

// ── 体重グラフ ──
(function(){
  var W=320,H=110,padL=24,padT=12,padB=18,padR=8;
  var innerW=W-padL-padR, innerH=H-padT-padB;
  var data=[];
  var best=null;
  /* 表示用の月ラベル。返り値が数字と '/' と '月' だけになるようにしてある。
     ここには保存済みカルテの weights[].ym がそのまま流れてくる。出力は
     buildSVG() と renderList() で innerHTML に連結されるため、任意の文字を
     通すと飼い主の公開ページで実行される（F-20260821-17 で実証済み）。
     エスケープではなく「数字以外を落とす」ことで、構造的に markup を返せなくする。 */
  function ymShort(s){
    var p=String(s||'').split('-');
    var digits=function(v){return String(v||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'');};
    var m=digits(p[1]);
    var d=digits(p[2]);
    if(p.length>=3&&d)return m+'/'+d;
    return m+'月';
  }
  function sortData(){data.sort(function(a,b){return a.ym<b.ym?-1:1;});}
  function buildSVG(){
    var kgs=data.map(function(d){return d.kg;});
    if(!kgs.length)return '<div style="text-align:center;color:#bbb;padding:20px;font-size:0.8rem">データなし</div>';
    var lo=Math.min.apply(null,kgs), hi=Math.max.apply(null,kgs);
    if(best!==null){lo=Math.min(lo,best);hi=Math.max(hi,best);}
    if(lo===hi){lo-=0.3;hi+=0.3;}
    var pad=(hi-lo)*0.18||0.2; lo-=pad; hi+=pad;
    var n=data.length;
    var x=function(i){return padL+(n===1?innerW/2:innerW*i/(n-1));};
    var y=function(kg){return padT+innerH*(hi-kg)/(hi-lo);};
    var svg='<svg class="wc-svg" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg">';
    if(best!==null){var gy=y(best).toFixed(1);svg+='<line class="wc-goal" x1="'+padL+'" y1="'+gy+'" x2="'+(padL+innerW)+'" y2="'+gy+'"></line>';svg+='<text class="wc-goal-lbl" x="'+(W-2)+'" y="'+(Number(gy)-3)+'">目標 '+best+'kg</text>';}
    if(n>=2){var pts=data.map(function(d,i){return x(i).toFixed(1)+','+y(d.kg).toFixed(1);}).join(' ');svg+='<polyline class="wc-line" points="'+pts+'"></polyline>';}
    data.forEach(function(d,i){
      var px=x(i).toFixed(1),py=y(d.kg).toFixed(1);
      svg+='<circle class="wc-pt" cx="'+px+'" cy="'+py+'" r="3"></circle>';
      svg+='<text class="wc-pt-lbl" x="'+px+'" y="'+(Number(py)-5)+'">'+d.kg+'</text>';
      svg+='<text class="wc-x-lbl" x="'+px+'" y="'+(H-3)+'">'+ymShort(d.ym)+'</text>';
    });
    svg+='</svg>';
    return svg;
  }
  function renderChart(){var h=document.getElementById('wcChart');if(h)h.innerHTML=buildSVG();}
  function renderList(){
    var l=document.getElementById('wcList');if(!l)return;
    l.innerHTML=data.map(function(d,i){
      return '<div class="wc-li"><span>'+ymShort(d.ym)+'</span><span style="font-weight:700;margin-left:6px">'+d.kg+' kg</span><button class="wc-li-del" data-idx="'+i+'">×</button></div>';
    }).join('');
  }
  function render(){sortData();renderChart();renderList();}
  // 体重登録: 日付はヒーローのカレンダーと同期（独立した日付選択なし）
  var newBtn=document.getElementById('wcNew');
  var inputRow=document.getElementById('wcInputRow');
  var addBtn=document.getElementById('wcAdd');
  var cancelBtn=document.getElementById('wcCancel');
  function heroDateVal(){
    var h=document.getElementById('heroDateInput');
    var v=h?(h.value||'').trim():'';
    return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:'';
  }
  function showInput(show){
    if(inputRow)inputRow.hidden=!show;
    if(newBtn)newBtn.style.display=show?'none':'';
    if(show){var k=document.getElementById('wcKg');if(k){k.value='';k.focus();}}
  }
  if(newBtn)newBtn.addEventListener('click',function(){showInput(true);});
  if(cancelBtn)cancelBtn.addEventListener('click',function(){showInput(false);});
  if(addBtn)addBtn.addEventListener('click',function(){
    var kgEl=document.getElementById('wcKg');
    var ymd=heroDateVal();
    if(!ymd){alert('先にヒーロー上部の日付を選んでください');return;}
    var kg=parseFloat(kgEl.value);
    if(!isFinite(kg)||kg<=0){alert('体重を数字で入力してください');return;}
    var ex=data.find(function(d){return d.ym===ymd;});
    if(ex)ex.kg=kg; else data.push({ym:ymd,kg:kg});
    kgEl.value='';showInput(false);render();
  });
  var list=document.getElementById('wcList');
  if(list)list.addEventListener('click',function(e){
    var b=e.target.closest('.wc-li-del');if(!b)return;
    var i=Number(b.dataset.idx);if(i>=0&&i<data.length){data.splice(i,1);render();}
  });
  // 目標体重線: best-weight フィールドから best を同期（publish-client が input を dispatch して再描画を促す。空/不正なら null=線非表示）
  var _bestField=document.querySelector('[data-field="best-weight"]');
  function syncBest(){if(!_bestField)return;var raw=(_bestField.value!==undefined&&_bestField.value!=='')?_bestField.value:(_bestField.textContent||'');var v=parseFloat(String(raw).replace(/[^0-9.]/g,''));best=isFinite(v)&&v>0?v:null;}
  if(_bestField)_bestField.addEventListener('input',function(){syncBest();render();});
  syncBest();
  render();
  // getter/setter 公開（契約#4: weight API）
  window.__SALTYDOG_GET_WEIGHTS = function(){ return data.map(function(d){return{ym:d.ym,kg:d.kg};}); };
  window.__SALTYDOG_SET_WEIGHTS = function(arr){
    if(!Array.isArray(arr))return;
    data.length=0;
    /* ym は heroDateVal() が /^\d{4}-\d{2}-\d{2}$/ を通したものしか作らない。
       保存済み JSON は無認証の POST /api/reports 経由でも入るので、
       アプリが作り得ない形は読み込み時点で捨てる（多層防御）。 */
    arr.forEach(function(item){
      if(!item||!isFinite(item.kg))return;
      var ym=String(item.ym||'');
      if(!/^\d{4}-\d{2}(-\d{2})?$/.test(ym))return;
      data.push({ym:ym,kg:Number(item.kg)});
    });
    render();
  };
})();

// ── 皮膚スパ描画ツール（beauty-report-mobile.html より移植） ──
function createDrawer(opts) {
  if (typeof Konva === 'undefined') return null;
  const container = opts.container, toolbar = opts.toolbar, section = opts.section;
  const canvasWrap = opts.canvasWrap, doneBtn = opts.doneBtn, srcImg = opts.srcImg;
  const fallbackIW = opts.imageW || 1008, fallbackIH = opts.imageH || 1064;
  if (!container || !toolbar || !section || !canvasWrap) return null;
  let stage = null, layer = null, bgImage = null, borderRect = null;
  let imageRect = {x:0,y:0,w:1,h:1};
  let currentTool = 'pen', currentColor = '#e85c5c';
  const PEN_W=7.5, ARROW_W=3, OPACITY=0.5, DEFAULT_FONT_N=0.05;
  const DRAW_TOOLS = ['pen','arrow'];
  const shapes = [];
  let live=null, startWorld=null, savedScrollY=null;
  const isTouch = ('ontouchstart' in window)||(navigator.maxTouchPoints>0);
  const pointers = new Map();
  let drawId=null, pinch=null, suppressDraw=false;
  let selText=null, selBox=null, selHandle=null, textDrag=null, lastTap=null, stampDrag=null;
  let selStamp=null, selStampBox=null, selStampHandle=null, stampResize=null;
  function containerPt(e){const r=container.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  function toWorld(cp){return{x:(cp.x-stage.x())/stage.scaleX(),y:(cp.y-stage.y())/stage.scaleY()};}
  function normPt(w){return{x:(w.x-imageRect.x)/imageRect.w,y:(w.y-imageRect.y)/imageRect.h};}
  function denorm(n){return{x:imageRect.x+n.x*imageRect.w,y:imageRect.y+n.y*imageRect.h};}
  function dist(a,b){return Math.hypot(b.x-a.x,b.y-a.y);}
  function center(a,b){return{x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
  function makeNode(s){
    const P=s.pts.map(denorm);
    if(s.kind==='pen')return new Konva.Line({points:P.flatMap(p=>[p.x,p.y]),stroke:s.color,strokeWidth:PEN_W,opacity:OPACITY,lineCap:'round',lineJoin:'round',tension:0.4,hitStrokeWidth:24});
    if(s.kind==='arrow'){const a=P[0],b=P[1];return new Konva.Arrow({points:[a.x,a.y,b.x,b.y],stroke:s.color,fill:s.color,strokeWidth:ARROW_W,opacity:OPACITY,pointerLength:10,pointerWidth:10,hitStrokeWidth:20});}
    if(s.kind==='text'){const t=new Konva.Text({x:P[0].x,y:P[0].y,text:s.text,fontSize:(s.fontN||DEFAULT_FONT_N)*imageRect.h,fontFamily:'sans-serif',fill:s.color,opacity:OPACITY});t.hitFunc(function(ctx){ctx.beginPath();ctx.rect(0,0,t.width(),t.height());ctx.closePath();ctx.fillStrokeShape(t);});return t;}
    if(s.kind==='stamp'&&!s.isImg){return new Konva.Text({x:P[0].x,y:P[0].y,text:s.src,fontSize:(s.fontN||0.12)*imageRect.h,fontFamily:'sans-serif',draggable:true});}
    return null;
  }
  function redrawShapes(){shapes.forEach(s=>{if(s.node)s.node.destroy();s.node=makeNode(s);if(s.node)layer.add(s.node);});if(selText)updateSelBox();layer.batchDraw();}
  function clearSel(){if(selBox){selBox.destroy();selBox=null;}if(selHandle){selHandle.destroy();selHandle=null;}}
  function updateSelBox(){
    if(!selText||!selText.node){clearSel();return;}
    const r=selText.node.getClientRect({relativeTo:layer});
    if(!selBox){selBox=new Konva.Rect({listening:false,stroke:'#4a90e2',strokeWidth:1.5,dash:[5,4],strokeScaleEnabled:false});layer.add(selBox);selHandle=new Konva.Rect({name:'sel-handle',fill:'#4a90e2',stroke:'#fff',strokeWidth:1.5,cornerRadius:2,strokeScaleEnabled:false});layer.add(selHandle);}
    const hs=20/stage.scaleX();
    selBox.setAttrs({x:r.x,y:r.y,width:r.width,height:r.height});
    selHandle.setAttrs({x:r.x+r.width-hs/2,y:r.y+r.height-hs/2,width:hs,height:hs});
    selBox.moveToTop();selHandle.moveToTop();
  }
  function selectText(sh){selText=sh;updateSelBox();layer.batchDraw();}
  function deselectText(){selText=null;clearSel();if(layer)layer.batchDraw();}
  function clearSelStamp(){if(selStampBox){selStampBox.destroy();selStampBox=null;}if(selStampHandle){selStampHandle.destroy();selStampHandle=null;}selStamp=null;if(layer)layer.batchDraw();}
  function updateSelStampBox(){
    if(!selStamp||!selStamp.node){clearSelStamp();return;}
    const r=selStamp.node.getClientRect({relativeTo:layer});
    if(!selStampBox){selStampBox=new Konva.Rect({listening:false,stroke:'#8b5cf6',strokeWidth:1.5,dash:[5,4],strokeScaleEnabled:false});layer.add(selStampBox);selStampHandle=new Konva.Rect({name:'stamp-handle',fill:'#8b5cf6',stroke:'#fff',strokeWidth:1.5,cornerRadius:3,strokeScaleEnabled:false});layer.add(selStampHandle);}
    const hs=20/stage.scaleX();
    selStampBox.setAttrs({x:r.x,y:r.y,width:r.width,height:r.height});
    selStampHandle.setAttrs({x:r.x+r.width-hs/2,y:r.y+r.height-hs/2,width:hs,height:hs});
    selStampBox.moveToTop();selStampHandle.moveToTop();
  }
  function selectStamp(sh){selStamp=sh;updateSelStampBox();layer.batchDraw();}
  function computeImageRect(){
    const sw=stage.width(),sh=stage.height();
    const iw=(srcImg&&srcImg.naturalWidth)||fallbackIW,ih=(srcImg&&srcImg.naturalHeight)||fallbackIH;
    const sc=Math.min(sw/iw,sh/ih);const w=iw*sc,h=ih*sc;
    imageRect={x:(sw-w)/2,y:(sh-h)/2,w:w,h:h};
  }
  function buildStage(){
    const w=canvasWrap.clientWidth,h=canvasWrap.clientHeight;
    if(!w||!h)return;
    /* サイズ変化なし: canvas clear は不要。bgImage 位置だけ更新して終了 */
    if(stage&&stage.width()===w&&stage.height()===h){
      computeImageRect();
      if(bgImage)bgImage.setAttrs({x:imageRect.x,y:imageRect.y,width:imageRect.w,height:imageRect.h});
      if(borderRect)borderRect.setAttrs({x:imageRect.x,y:imageRect.y,width:imageRect.w,height:imageRect.h});
      layer.batchDraw();
      return;
    }
    /* サイズ変化あり（または初回）: canvas を再構築 */
    selText=null;clearSel();
    if(!stage){stage=new Konva.Stage({container:container,width:w,height:h});layer=new Konva.Layer();stage.add(layer);bindPointers();}else{stage.size({width:w,height:h});}
    stage.scale({x:1,y:1});stage.position({x:0,y:0});
    computeImageRect();
    if(!bgImage){bgImage=new Konva.Image({listening:false});layer.add(bgImage);}
    if(srcImg&&srcImg.complete&&srcImg.naturalWidth)bgImage.image(srcImg);
    bgImage.setAttrs({x:imageRect.x,y:imageRect.y,width:imageRect.w,height:imageRect.h});
    bgImage.moveToBottom();
    /* srcImg なし（白紙キャンバス）: imageRect の境界を黒線で表示 */
    if(!srcImg){
      if(!borderRect){borderRect=new Konva.Rect({listening:false,stroke:'#222',strokeWidth:2,fill:'transparent',strokeScaleEnabled:false});layer.add(borderRect);}
      borderRect.setAttrs({x:imageRect.x,y:imageRect.y,width:imageRect.w,height:imageRect.h});
    }
    redrawShapes();
  }
  function lockScroll(){if(!isTouch||savedScrollY!==null)return;savedScrollY=window.scrollY;document.body.style.position='fixed';document.body.style.top='-'+savedScrollY+'px';document.body.style.width='100%';document.body.style.overflow='hidden';}
  function unlockScroll(){if(savedScrollY===null)return;const y=savedScrollY;savedScrollY=null;document.body.style.position='';document.body.style.top='';document.body.style.width='';document.body.style.overflow='';window.scrollTo(0,y);}
  function beginStroke(world){
    startWorld=world;
    if(currentTool==='pen'){const node=new Konva.Line({points:[world.x,world.y],stroke:currentColor,strokeWidth:PEN_W,opacity:OPACITY,lineCap:'round',lineJoin:'round',tension:0.4,hitStrokeWidth:24});layer.add(node);live={kind:'pen',node:node,raw:[world]};}
    else if(currentTool==='arrow'){const node=new Konva.Arrow({points:[world.x,world.y,world.x,world.y],stroke:currentColor,fill:currentColor,strokeWidth:ARROW_W,opacity:OPACITY,pointerLength:10,pointerWidth:10,hitStrokeWidth:20});layer.add(node);live={kind:'arrow',node:node};}
    layer.batchDraw();
  }
  function appendStroke(world){if(!live)return;live.endWorld=world;if(live.kind==='pen'){live.raw.push(world);live.node.points(live.raw.flatMap(q=>[q.x,q.y]));}else if(live.kind==='arrow'){live.node.points([startWorld.x,startWorld.y,world.x,world.y]);}layer.batchDraw();}
  function finalizeStroke(){
    if(!live)return;let s=null;
    if(live.kind==='pen'){if(live.raw.length>=2)s={kind:'pen',color:currentColor,pts:live.raw.map(normPt),node:live.node};else live.node.destroy();}
    else{const a=startWorld,b=live.endWorld;if(b&&dist(a,b)>=4)s={kind:live.kind,color:currentColor,pts:[normPt(a),normPt(b)],node:live.node};else live.node.destroy();}
    if(s)shapes.push(s);live=null;startWorld=null;layer.batchDraw();
  }
  function clampAxis(v,min,max){return min>max?(min+max)/2:Math.min(max,Math.max(min,v));}
  function clampPos(pos,scale){
    if(scale<=1.001)return{x:0,y:0};
    const sw=stage.width(),sh=stage.height();
    const minX=sw-(imageRect.x+imageRect.w)*scale,maxX=-imageRect.x*scale;
    const minY=sh-(imageRect.y+imageRect.h)*scale,maxY=-imageRect.y*scale;
    return{x:clampAxis(pos.x,minX,maxX),y:clampAxis(pos.y,minY,maxY)};
  }
  function doPinch(){
    const vals=[...pointers.values()];const p1=vals[0],p2=vals[1];
    const nd=dist(p1,p2),nc=center(p1,p2);
    if(!pinch.lastDist){pinch.lastDist=nd;pinch.lastCenter=nc;return;}
    const scaleBy=nd/pinch.lastDist;
    const pointTo={x:(nc.x-stage.x())/stage.scaleX(),y:(nc.y-stage.y())/stage.scaleY()};
    const newScale=Math.min(5,Math.max(1,stage.scaleX()*scaleBy));
    stage.scale({x:newScale,y:newScale});
    const dx=nc.x-pinch.lastCenter.x,dy=nc.y-pinch.lastCenter.y;
    const np=clampPos({x:nc.x-pointTo.x*newScale+dx,y:nc.y-pointTo.y*newScale+dy},newScale);
    stage.position(np);stage.batchDraw();pinch.lastDist=nd;pinch.lastCenter=nc;
  }
  /* テキスト/スタンプヒット検索を名前付き関数に抽出（onPD の IIFE ネスト解消）*/
  function findTextHit(wp){
    for(let i=shapes.length-1;i>=0;i--){
      const sh=shapes[i];
      if(sh.kind!=='text'||!sh.node)continue;
      const r=sh.node.getClientRect({relativeTo:layer});
      if(wp.x>=r.x&&wp.x<=r.x+r.width&&wp.y>=r.y&&wp.y<=r.y+r.height)return sh;
    }
    return null;
  }
  function findStampHit(hit){
    if(!hit||hit===bgImage||hit===selBox||hit===selHandle||hit===selStampBox||hit===selStampHandle)return null;
    for(let i=shapes.length-1;i>=0;i--){
      const sh=shapes[i];
      if(sh.kind==='stamp'&&sh.node===hit)return sh;
    }
    return null;
  }
  function bindPointers(){
    container.addEventListener('pointerdown',onPD,{passive:false});
    container.addEventListener('pointermove',onPM,{passive:false});
    container.addEventListener('pointerup',onPU,{passive:false});
    container.addEventListener('pointercancel',onPU,{passive:false});
    container.addEventListener('pointerleave',onPU,{passive:false});
  }
  function onPD(e){
    e.preventDefault();const cp=containerPt(e);pointers.set(e.pointerId,cp);
    if(pointers.size===2){if(live)finalizeStroke();textDrag=null;drawId=null;suppressDraw=true;const vals=[...pointers.values()];pinch={lastDist:dist(vals[0],vals[1]),lastCenter:center(vals[0],vals[1])};return;}
    if(pointers.size>2)return;
    lockScroll();if(suppressDraw)return;
    layer.drawHit();const hit=layer.getIntersection(cp);const wp=toWorld(cp);
    const textHit=findTextHit(wp);
    if(currentTool==='eraser'){
      if(textHit){if(selText===textHit)deselectText();textHit.node.destroy();shapes.splice(shapes.indexOf(textHit),1);layer.batchDraw();return;}
      if(hit&&hit!==bgImage&&hit!==selBox&&hit!==selHandle){const i=shapes.findIndex(s=>s.node===hit);if(i>=0){shapes[i].node.destroy();shapes.splice(i,1);layer.batchDraw();}}
      return;
    }
    if(selText&&selHandle){const hr=selHandle.getClientRect({relativeTo:layer});if(wp.x>=hr.x&&wp.x<=hr.x+hr.width&&wp.y>=hr.y&&wp.y<=hr.y+hr.height){const r=selText.node.getClientRect({relativeTo:layer});textDrag={mode:'resize',id:e.pointerId,startWorld:wp,startFontN:(selText.fontN||DEFAULT_FONT_N),baseH:r.height};return;}}
    if(textHit){selectText(textHit);textDrag={mode:'move',id:e.pointerId,startWorld:wp,origPt:{x:textHit.pts[0].x,y:textHit.pts[0].y},moved:false};return;}
    // スタンプリサイズハンドル
    if(selStamp&&selStampHandle){const hr=selStampHandle.getClientRect({relativeTo:layer});if(wp.x>=hr.x&&wp.x<=hr.x+hr.width&&wp.y>=hr.y&&wp.y<=hr.y+hr.height){const r=selStamp.node.getClientRect({relativeTo:layer});stampResize={id:e.pointerId,startWorld:wp,startFontN:selStamp.fontN||0.12,startSizeN:selStamp.sizeN||0.18,baseH:r.height};return;}}
    const stampHit=findStampHit(hit);
    if(stampHit){deselectText();stampDrag={id:e.pointerId,shape:stampHit,startWorld:wp,origPt:{x:stampHit.pts[0].x,y:stampHit.pts[0].y},moved:false};return;}
    clearSelStamp();deselectText();
    if(DRAW_TOOLS.indexOf(currentTool)>=0){drawId=e.pointerId;beginStroke(toWorld(cp));}
    else if(currentTool==='text'){drawId=e.pointerId;startWorld=toWorld(cp);}
  }
  function onPM(e){
    if(!pointers.has(e.pointerId))return;const cp=containerPt(e);pointers.set(e.pointerId,cp);
    if(pointers.size>=2&&pinch){e.preventDefault();doPinch();return;}
    if(textDrag&&textDrag.id===e.pointerId&&selText){
      e.preventDefault();const w=toWorld(cp);
      if(textDrag.mode==='move'){if(!textDrag.moved&&Math.hypot(w.x-textDrag.startWorld.x,w.y-textDrag.startWorld.y)<4)return;textDrag.moved=true;const dxn=(w.x-textDrag.startWorld.x)/imageRect.w,dyn=(w.y-textDrag.startWorld.y)/imageRect.h;selText.pts=[{x:textDrag.origPt.x+dxn,y:textDrag.origPt.y+dyn}];selText.node.position(denorm(selText.pts[0]));}
      else{const f=Math.max(0.25,(textDrag.baseH+(w.y-textDrag.startWorld.y))/textDrag.baseH);selText.fontN=Math.max(0.02,textDrag.startFontN*f);selText.node.fontSize(selText.fontN*imageRect.h);}
      updateSelBox();layer.batchDraw();return;
    }
    if(stampResize&&stampResize.id===e.pointerId&&selStamp){e.preventDefault();const w=toWorld(cp);const f=Math.max(0.25,(stampResize.baseH+(w.y-stampResize.startWorld.y))/stampResize.baseH);if(!selStamp.isImg){selStamp.fontN=Math.max(0.02,stampResize.startFontN*f);selStamp.node.fontSize(selStamp.fontN*imageRect.h);}else{selStamp.sizeN=Math.max(0.02,stampResize.startSizeN*f);const s=selStamp.sizeN*imageRect.w;selStamp.node.size({width:s,height:s});}updateSelStampBox();layer.batchDraw();return;}
    if(stampDrag&&stampDrag.id===e.pointerId){e.preventDefault();const w=toWorld(cp);if(!stampDrag.moved&&Math.hypot(w.x-stampDrag.startWorld.x,w.y-stampDrag.startWorld.y)<4)return;stampDrag.moved=true;const dxn=(w.x-stampDrag.startWorld.x)/imageRect.w,dyn=(w.y-stampDrag.startWorld.y)/imageRect.h;stampDrag.shape.pts=[{x:stampDrag.origPt.x+dxn,y:stampDrag.origPt.y+dyn}];stampDrag.shape.node.position(denorm(stampDrag.shape.pts[0]));if(selStamp===stampDrag.shape)updateSelStampBox();layer.batchDraw();return;}
    if(drawId===e.pointerId&&live){e.preventDefault();appendStroke(toWorld(cp));}
  }
  function onPU(e){
    if(!pointers.has(e.pointerId))return;
    pointers.delete(e.pointerId);
    if(textDrag&&textDrag.id===e.pointerId){
      if(textDrag.mode==='move'&&!textDrag.moved&&selText){const now=Date.now();if(lastTap&&lastTap.shape===selText&&(now-lastTap.time)<350){lastTap=null;openTextEdit(selText);}else lastTap={shape:selText,time:now};}
      textDrag=null;
    }else if(e.pointerId===drawId){if(currentTool==='text'&&!live&&startWorld){openTextInput(containerPt(e),startWorld);startWorld=null;}else finalizeStroke();drawId=null;}
    if(stampResize&&e.pointerId===stampResize.id){stampResize=null;updateSelStampBox();}
    if(stampDrag&&e.pointerId===stampDrag.id){if(!stampDrag.moved)selectStamp(stampDrag.shape);stampDrag=null;}
    if(pointers.size<2)pinch=null;
    if(pointers.size===0){suppressDraw=false;unlockScroll();}
  }
  function openTextInput(cp,world){
    const input=document.createElement('textarea');input.className='bm-text-input';input.rows=1;input.placeholder='文字を入力';
    canvasWrap.appendChild(input);const cleanup=placeInput(input);input.focus();
    let done=false;
    const fin=()=>{if(done)return;done=true;cleanup();const v=input.value.replace(/\s+$/,'');if(v){const s={kind:'text',color:currentColor,fontN:DEFAULT_FONT_N,text:v,pts:[normPt(world)]};s.node=makeNode(s);layer.add(s.node);shapes.push(s);selectText(s);}input.remove();};
    input.addEventListener('blur',fin);
  }
  function placeInput(input){
    input.style.position='fixed';input.style.left='8px';input.style.right='8px';input.style.width='auto';input.style.zIndex='10000';input.style.fontSize='16px';
    const vv=window.visualViewport;
    const grow=()=>{if(input.tagName==='TEXTAREA'){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,140)+'px';}};
    const place=()=>{grow();const h=vv?vv.height:window.innerHeight;const top=vv?vv.offsetTop:0;const eh=input.offsetHeight||44;input.style.top=(top+h-eh-8)+'px';};
    place();if(vv){vv.addEventListener('resize',place);vv.addEventListener('scroll',place);}input.addEventListener('input',place);
    const t1=setTimeout(place,300);
    return()=>{if(vv){vv.removeEventListener('resize',place);vv.removeEventListener('scroll',place);}input.removeEventListener('input',place);clearTimeout(t1);};
  }
  function openTextEdit(sh){
    if(!sh||!sh.node)return;const input=document.createElement('textarea');input.className='bm-text-input';input.rows=1;input.value=sh.text;
    canvasWrap.appendChild(input);const cleanup=placeInput(input);input.focus();
    const len=input.value.length;try{input.setSelectionRange(len,len);}catch(_e){/* setSelectionRange非対応: カーソル末尾移動は best-effort のため無視 */}
    let done=false;
    const fin=()=>{if(done)return;done=true;cleanup();const v=input.value.replace(/\s+$/,'');if(v){sh.text=v;sh.node.text(v);}else{if(selText===sh)deselectText();sh.node.destroy();const i=shapes.indexOf(sh);if(i>=0)shapes.splice(i,1);}input.remove();if(selText===sh)updateSelBox();layer.batchDraw();};
    input.addEventListener('blur',fin);
  }
  function undo(){if(!shapes.length)return;const s=shapes.pop();if(s.node)s.node.destroy();layer.batchDraw();}
  toolbar.addEventListener('click',e=>{
    const swatch=e.target.closest('.bm-color-swatch');
    if(swatch){currentColor=swatch.dataset.color;toolbar.querySelectorAll('.bm-color-swatch').forEach(s=>s.classList.remove('active'));swatch.classList.add('active');return;}
    const btn=e.target.closest('.bm-tool-btn');if(!btn)return;const tool=btn.dataset.tool;if(!tool)return;
    if(tool==='undo'){undo();return;}
    deselectText();currentTool=tool;
    toolbar.querySelectorAll('.bm-tool-btn[data-tool]').forEach(b=>{if(b.dataset.tool!=='undo')b.classList.remove('active');});btn.classList.add('active');
  });
  /* _modeTransition: enterDrawingMode/exitDrawingMode でCSS position:fixed の付加・除去が
     ネイティブ window resize を誘発する。その resize 起因の buildStage と
     rAF×2 の buildStage が競合して stage.size()→canvas clear が複数回走る（チカチカ）。
     遷移中フラグで resize 起因の buildStage を抑制し、rAF×2 の1回だけにする。
     Fix 2026-06-04 */
  let _modeTransition=false;
  function enterDrawingMode(){if(section.classList.contains('is-drawing'))return;const pd=section.closest('details');if(pd&&!pd.open)pd.open=true;_modeTransition=true;section.classList.add('is-drawing');document.body.classList.add('is-drawing-active');requestAnimationFrame(()=>requestAnimationFrame(()=>{_modeTransition=false;buildStage();}));}
  function exitDrawingMode(){_modeTransition=true;section.classList.remove('is-drawing');if(!document.querySelector('.draw-section.is-drawing'))document.body.classList.remove('is-drawing-active');unlockScroll();pointers.clear();drawId=null;pinch=null;suppressDraw=false;/* is-drawing 解除後の CSS レイアウト確定を待ち2フレーム後に再フィット */requestAnimationFrame(()=>requestAnimationFrame(()=>{_modeTransition=false;buildStage();}));}
  canvasWrap.addEventListener('click',()=>{if(!section.classList.contains('is-drawing'))enterDrawingMode();});
  if(doneBtn)doneBtn.addEventListener('click',e=>{e.stopPropagation();exitDrawingMode();});
  let _resizeTimer=null;window.addEventListener('resize',()=>{if(!stage||_modeTransition)return;clearTimeout(_resizeTimer);_resizeTimer=setTimeout(buildStage,50);});
  if(srcImg&&srcImg.complete&&srcImg.naturalWidth)buildStage();
  else if(srcImg)srcImg.addEventListener('load',buildStage,{once:true});
  else buildStage();
  function addStamp(src){
    if(!stage)buildStage();if(!stage)return;
    const cx=imageRect.x+imageRect.w/2,cy=imageRect.y+imageRect.h/2;
    const isImg=src&&src.startsWith('data:');
    if(isImg){
      const im=new Image();
      im.onload=function(){
        const sz=Math.min(imageRect.w,imageRect.h)*0.18;
        const node=new Konva.Image({x:cx-sz/2,y:cy-sz/2,image:im,width:sz,height:sz,draggable:true,opacity:0.85});
        layer.add(node);shapes.push({kind:'stamp',isImg:true,src:src,pts:[normPt({x:cx-sz/2,y:cy-sz/2})],sizeN:sz/imageRect.w,node:node});layer.batchDraw();
      };im.src=src;
    } else {
      const fontN=0.12,fontSize=fontN*imageRect.h;
      const node=new Konva.Text({x:cx,y:cy,text:src,fontSize:fontSize,fontFamily:'sans-serif',draggable:true});
      layer.add(node);shapes.push({kind:'stamp',isImg:false,src:src,pts:[normPt({x:cx,y:cy})],fontN:fontN,node:node});layer.batchDraw();
    }
  }
  function exportImage(){try{if(!stage)buildStage();if(!stage)return'';deselectText();var _ss=stage.scale(),_sp=stage.position();stage.scale({x:1,y:1});stage.position({x:0,y:0});stage.draw();var _u=stage.toDataURL({x:imageRect.x,y:imageRect.y,width:imageRect.w,height:imageRect.h,pixelRatio:2});stage.scale(_ss);stage.position(_sp);stage.batchDraw();return _u;}catch(e){console.error('exportImage failed',e);return'';}}
  return{exportImage,refresh:buildStage,addStamp};
}
window.__SALTYDOG_BM = createDrawer({
  container: document.getElementById('bm-konva'),
  toolbar: document.getElementById('bm-toolbar'),
  section: document.getElementById('bm-section'),
  canvasWrap: document.getElementById('bm-canvas-wrap'),
  doneBtn: document.getElementById('bm-done-btn'),
  srcImg: document.querySelector('#bm-canvas-wrap .bm-single'),
  imageW: 1008, imageH: 1064,
});
window.__SALTYDOG_TC = createDrawer({
  container: document.getElementById('tc-konva'),
  toolbar: document.getElementById('tc-toolbar'),
  section: document.getElementById('tc-section'),
  canvasWrap: document.getElementById('tc-canvas-wrap'),
  doneBtn: document.getElementById('tc-done-btn'),
  srcImg: document.querySelector('#tc-canvas-wrap .bm-single'),
  imageW: 390, imageH: 417,
});
window.__SALTYDOG_TCN = createDrawer({
  container: document.getElementById('tcn-konva'),
  toolbar: document.getElementById('tcn-toolbar'),
  section: document.getElementById('tcn-section'),
  canvasWrap: document.getElementById('tcn-canvas-wrap'),
  doneBtn: document.getElementById('tcn-done-btn'),
  srcImg: null,
  imageW: 390, imageH: 300,
});
window.__SALTYDOG_TEETH = createDrawer({
  container: document.getElementById('tt-konva'),
  toolbar: document.getElementById('tt-toolbar'),
  section: document.getElementById('tt-section'),
  canvasWrap: document.getElementById('tt-canvas-wrap'),
  doneBtn: document.getElementById('tt-done-btn'),
  srcImg: document.querySelector('#tt-canvas-wrap .bm-single'),
  imageW: 700, imageH: 1162,
});
// 皮膚スパカードのみ展開時に描画面を再構築（他カードのtoggleで再描画しない）
const spaCard = document.querySelector('.hc-row.r1 .hc.wide');
if (spaCard) {
  spaCard.addEventListener('toggle',()=>{
    if(!spaCard.open)return;
    if(window.__SALTYDOG_BM&&window.__SALTYDOG_BM.refresh)requestAnimationFrame(()=>requestAnimationFrame(window.__SALTYDOG_BM.refresh));
  });
}
const teethCard = document.getElementById('teethCard');
if (teethCard) {
  teethCard.addEventListener('toggle',()=>{
    if(!teethCard.open)return;
    if(window.__SALTYDOG_TEETH&&window.__SALTYDOG_TEETH.refresh)requestAnimationFrame(()=>requestAnimationFrame(window.__SALTYDOG_TEETH.refresh));
  });
}
const tcCard = document.getElementById('tcCard');
if (tcCard) {
  tcCard.addEventListener('toggle',()=>{
    if(!tcCard.open)return;
    if(window.__SALTYDOG_TC&&window.__SALTYDOG_TC.refresh)requestAnimationFrame(()=>requestAnimationFrame(window.__SALTYDOG_TC.refresh));
    if(window.__SALTYDOG_TCN&&window.__SALTYDOG_TCN.refresh)requestAnimationFrame(()=>requestAnimationFrame(window.__SALTYDOG_TCN.refresh));
  });
}
document.querySelectorAll('.tt-pick').forEach((el)=>{
  el.addEventListener('click',()=>{
    document.querySelectorAll('.tt-pick').forEach((x)=>x.classList.remove('is-picked'));
    el.classList.add('is-picked');
  });
});
document.querySelectorAll('.nail-lv').forEach((el)=>{
  el.addEventListener('click',()=>{
    document.querySelectorAll('.nail-lv').forEach((x)=>x.classList.remove('is-picked'));
    el.classList.add('is-picked');
  });
});
document.querySelector('.opts-grid').addEventListener('click',(e)=>{
  // ×ボタンは削除のみ（トグル禁止）
  const del = e.target.closest('.opt-del');
  if(del){
    e.preventDefault();
    e.stopImmediatePropagation();
    del.closest('.opt').remove();
    return;
  }
  // ×以外の場所をタップ→トグル
  const el = e.target.closest('.opt');
  if(!el || el.classList.contains('opt-del')) return;
  el.classList.toggle('on');
  const chk = el.querySelector('.chk');
  if(chk) chk.textContent = el.classList.contains('on') ? '✓' : '';
});
(function(){
  var editBtn  = document.getElementById('optsEditBtn');
  var addRow   = document.getElementById('optsAddRow');
  var input    = document.getElementById('optsAddInput');
  var submit   = document.getElementById('optsAddSubmit');
  var grid     = document.querySelector('.opts-grid');
  var optsCard = document.querySelector('.opts-card');
  if(!editBtn||!addRow||!input||!submit||!grid||!optsCard) return;
  editBtn.addEventListener('click',function(){
    optsCard.classList.toggle('is-editing');
    var editing = optsCard.classList.contains('is-editing');
    editBtn.textContent = editing ? '完了' : '編集';
    if(editing) input.focus();
  });
  submit.addEventListener('click',function(){
    var val = input.value.trim();
    if(!val) return;
    var span = document.createElement('span');
    span.className = 'opt';
    var chk = document.createElement('span'); chk.className = 'chk';
    var label = document.createElement('span'); label.className = 'opt-label'; label.textContent = val;
    var delBtn = document.createElement('button'); delBtn.className = 'opt-del'; delBtn.type = 'button'; delBtn.textContent = '×';
    span.appendChild(chk); span.appendChild(label); span.appendChild(delBtn);
    grid.appendChild(span);
    input.value = '';
    input.focus();
  });
  input.addEventListener('keydown',function(e){ if(e.key==='Enter') submit.click(); });
})();
const SKIN_TYPES = ['湿疹','カサブタ','イボ','傷'];
const SKIN_CHANGES = ['成長','縮小','治療中','完治'];
function refreshSkinBadge(){
  let n = 0;
  for(let i=1;i<=10;i+=1){
    const el = document.querySelector('[data-field="skin-loc-' + i + '"]');
    if(el && el.textContent.trim()) n += 1;
  }
  const b = document.getElementById('badge-skin');
  if (b) b.textContent = n ? '気になる箇所 ' + n + '件' : '記録なし';
}
function renderSkinCards(){
  const sb = document.getElementById('skin-body');
  if(!sb) return;
  let html = '';
  for(let i=1;i<=10;i+=1){
    const types = SKIN_TYPES.map((t)=>'<span class="sk-pick" data-skin-type="' + i + '" data-val="' + t + '">' + t + '</span>').join('');
    const changes = SKIN_CHANGES.map((c)=>'<span class="sk-pick" data-skin-change="' + i + '" data-val="' + c + '">' + c + '</span>').join('');
    html += '<div class="sk-card sk-card-' + ((i - 1) % 4) + '">'
      + '<div class="sk-no">' + i + '</div>'
      + '<div class="sk-card-body">'
      +   '<div class="sk-card-loc" contenteditable="true" data-field="skin-loc-' + i + '"></div>'
      +   '<div class="sk-pick-row">' + types + '</div>'
      +   '<div class="sk-size" contenteditable="true" data-field="skin-size-' + i + '">mm / cm</div>'
      +   '<div class="sk-pick-row">' + changes + '</div>'
      + '</div>'
      + '</div>';
  }
  sb.innerHTML = html;
  sb.addEventListener('click',(e)=>{
    const t = e.target.closest('.sk-pick');
    if(!t) return;
    const group = t.dataset.skinType || t.dataset.skinChange;
    const attr = t.dataset.skinType ? 'data-skin-type' : 'data-skin-change';
    sb.querySelectorAll('.sk-pick[' + attr + '="' + group + '"]').forEach((x)=>x.classList.remove('is-picked'));
    t.classList.add('is-picked');
  });
  sb.addEventListener('input', refreshSkinBadge);
  sb.addEventListener('click', refreshSkinBadge);
  refreshSkinBadge();
}
renderSkinCards();

// ── 耳レベル選択 ──
(function(){
  function updateEarBadge(){
    var rightPicked = document.querySelector('.ear-cell[data-ear="right"].is-picked');
    var leftPicked  = document.querySelector('.ear-cell[data-ear="left"].is-picked');
    var rVal = rightPicked ? rightPicked.dataset.val : '-';
    var lVal = leftPicked  ? leftPicked.dataset.val  : '-';
    var badge = document.getElementById('badge-ear');
    if(badge) badge.textContent = '右' + rVal + '・左' + lVal;
  }
  document.querySelectorAll('.ear-cell').forEach(function(el){
    el.addEventListener('click', function(){
      var side = el.dataset.ear;
      document.querySelectorAll('.ear-cell[data-ear="' + side + '"]').forEach(function(x){ x.classList.remove('is-picked'); });
      el.classList.add('is-picked');
      updateEarBadge();
    });
  });
  updateEarBadge();
})();

// ── スタンプ管理 ──
(function(){
  var STAMP_KEY = 'ponchi_stamps_v1';
  var DEFAULT_STAMPS = ['🐾','❤️','⭐','✅','❌','❕','➡️','🔵'];
  function loadStamps(){
    try{ return JSON.parse(localStorage.getItem(STAMP_KEY)||'null')||DEFAULT_STAMPS.map(function(e,i){return{id:'d'+i,src:e,label:e};}); }
    catch(_){ return DEFAULT_STAMPS.map(function(e,i){return{id:'d'+i,src:e,label:e};}); }
  }
  function saveStamps(arr){ try{localStorage.setItem(STAMP_KEY,JSON.stringify(arr));}catch(_){} }
  var stamps = loadStamps();
  var _panels = [];
  function renderItems(itemsEl, onSelect){
    if(!itemsEl) return;
    itemsEl.innerHTML = '';
    stamps.forEach(function(st){
      var wrap=document.createElement('div');
      wrap.style.cssText='position:relative;display:inline-flex;';
      var btn=document.createElement('button');
      btn.type='button'; btn.className='stamp-item'; btn.title=st.label||st.src;
      if(st.src&&st.src.startsWith('data:')){var img=document.createElement('img');img.src=st.src;btn.appendChild(img);}
      else btn.textContent=st.src;
      btn.addEventListener('click',function(){onSelect(st);});
      var del=document.createElement('button');
      del.type='button'; del.textContent='×'; del.className='stamp-item-del';
      del.addEventListener('click',function(e){
        e.stopPropagation();
        var i=stamps.findIndex(function(s){return s.id===st.id;});
        if(i>=0){stamps.splice(i,1);saveStamps(stamps);refreshAll();}
      });
      wrap.appendChild(btn); wrap.appendChild(del);
      itemsEl.appendChild(wrap);
    });
  }
  function refreshAll(){ _panels.forEach(function(p){renderItems(p.itemsEl,p.onSelect);}); }
  function renderStampPanel(itemsEl, addBtnEl, onSelect, panelEl){
    _panels.push({itemsEl:itemsEl,onSelect:onSelect});
    renderItems(itemsEl, onSelect);
    if(panelEl){
      var editToggle=panelEl.querySelector('.stamp-edit-toggle');
      if(editToggle){editToggle.addEventListener('click',function(){panelEl.classList.toggle('is-editing');editToggle.textContent=panelEl.classList.contains('is-editing')?'完了':'編集';});}
    }
    if(addBtnEl){
      addBtnEl.addEventListener('click',function(){
        var fi=document.createElement('input');fi.type='file';fi.accept='image/*';fi.style.display='none';
        document.body.appendChild(fi);fi.click();
        fi.addEventListener('change',function(){
          var f=fi.files&&fi.files[0];if(!f){fi.remove();return;}
          var r=new FileReader();
          r.onload=function(ev){
            var st={id:'u'+Date.now(),src:ev.target.result,label:'カスタム'};
            stamps.push(st);saveStamps(stamps);refreshAll();fi.remove();
          };
          r.readAsDataURL(f);
        });
      });
    }
  }
  function onStampSelect(drawer, section, panelEl){
    return function(st){
      if(!drawer||!drawer.addStamp) return;
      drawer.addStamp(st.src);
      panelEl.hidden=true;
    };
  }
  window.__PONCHI_STAMP_RENDER = function(bmDrawer, ttDrawer){
    if(document.body.classList.contains('is-readonly')) return;
    var bmPanel = document.getElementById('bm-stamp-panel');
    var bmItems = document.getElementById('bm-stamp-items');
    var bmAdd   = document.getElementById('bm-stamp-add');
    var ttPanel = document.getElementById('tt-stamp-panel');
    var ttItems = document.getElementById('tt-stamp-items');
    var ttAdd   = document.getElementById('tt-stamp-add');
    renderStampPanel(bmItems, bmAdd, function(st){
      if(bmDrawer&&bmDrawer.addStamp) bmDrawer.addStamp(st.src);
      if(bmPanel) bmPanel.hidden=true;
    }, bmPanel);
    renderStampPanel(ttItems, ttAdd, function(st){
      if(ttDrawer&&ttDrawer.addStamp) ttDrawer.addStamp(st.src);
      if(ttPanel) ttPanel.hidden=true;
    }, ttPanel);
    var bmBar = document.getElementById('bm-toolbar');
    var ttBar = document.getElementById('tt-toolbar');
    if(bmBar) bmBar.addEventListener('click',function(e){
      var btn=e.target.closest('[data-tool="stamp"]'); if(!btn)return;
      bmPanel.hidden=!bmPanel.hidden;
    });
    if(ttBar) ttBar.addEventListener('click',function(e){
      var btn=e.target.closest('[data-tool="stamp"]'); if(!btn)return;
      ttPanel.hidden=!ttPanel.hidden;
    });
  };
  window.__PONCHI_STAMP_PANEL = renderStampPanel;
  window.saveStamps = saveStamps;
})();

// ── 写真アップロード機構（契約#5） ──
(function(){
  var _photoSlots = {};
  // hidden file input（単一・再利用）
  var fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  var _pendingKey = null;
  var _pendingImg = null;

  function triggerUpload(key, imgEl){
    _pendingKey = key;
    _pendingImg = imgEl;
    fileInput.value = '';
    fileInput.click();
  }

  /* 取り込んだ写真を縮めてから持つ（D-20260824-30 の 4）。
     iPhone の 12MP JPEG は 2〜4MB。カルテ1件で写真7枚まで入るので、無加工だと
     十数MBになり、15件/日で月 7GB を超える（Supabase Free は 1GB・Pro でも 100GB）。
     しかも削除しても Storage からは減らないので、入れた分だけ積み上がる。
     カルテは手のひらの画面で見るものなので、長辺 1600px あれば足りる。

     縮小だけで拡大はしない（元が小さい画像をぼかさない）。デコードできない形式
     （HEIC など）は元のまま通し、これまでどおりアップロード側の検査に弾かせる——
     ここで握り潰すと「なぜ失敗したか」が出せなくなる。 */
  var MAX_PHOTO_EDGE = 1600;
  var PHOTO_QUALITY = 0.82;

  function shrinkPhoto(dataUrl, done){
    var probe = new Image();
    probe.onload = function(){
      var w = probe.naturalWidth || probe.width;
      var h = probe.naturalHeight || probe.height;
      var longEdge = Math.max(w, h);
      if(!longEdge || longEdge <= MAX_PHOTO_EDGE){ done(dataUrl); return; }
      var scale = MAX_PHOTO_EDGE / longEdge;
      var canvas = document.createElement('canvas');
      canvas.width  = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      var ctx = canvas.getContext('2d');
      if(!ctx){ done(dataUrl); return; }
      var out = '';
      try {
        ctx.drawImage(probe, 0, 0, canvas.width, canvas.height);
        out = canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
      } catch(_e){ out = ''; }
      /* 縮めたのに大きくなる場合（元が高圧縮の小さいJPEGなど）は元を使う。 */
      done(out && out.length < dataUrl.length ? out : dataUrl);
    };
    probe.onerror = function(){ done(dataUrl); };
    probe.src = dataUrl;
  }

  fileInput.addEventListener('change', function(){
    var file = fileInput.files && fileInput.files[0];
    if(!file || !_pendingImg) return;
    var reader = new FileReader();
    reader.onload = function(ev){
      /* 縮小は非同期。待っている間に別のスロットが選ばれても取り違えないよう、
         対象をここで確定させておく。 */
      var img = _pendingImg;
      var key = _pendingKey;
      _pendingKey = null;
      _pendingImg = null;
      shrinkPhoto(ev.target.result, function(src){
        img.src = src;
        /* 写真設定後はプレースホルダ属性を除去 */
        img.removeAttribute('data-empty');
        _photoSlots[key] = src;
      });
    };
    reader.readAsDataURL(file);
  });

  // 各 data-photo img にクリックハンドラを付与
  document.querySelectorAll('img[data-photo]').forEach(function(img){
    img.addEventListener('click', function(){
      // is-readonly 時はアップロード不可
      if(document.body.classList.contains('is-readonly')) return;
      triggerUpload(img.dataset.photo, img);
    });
  });

  // 公開API（契約#5: SaltyDogPonchiPhoto）
  window.SaltyDogPonchiPhoto = {
    set: function(key, src){
      var img = document.querySelector('img[data-photo="' + key + '"]');
      if(img){
        img.src = src;
        /* src が設定された場合はプレースホルダ属性を除去。空文字の場合（clearReport）は付与 */
        if(src){
          img.removeAttribute('data-empty');
        } else {
          /* clearReport から呼ばれた場合は編集モード判定して data-empty を付与 */
          var isEdit = !window.__VIEW__ && !document.body.classList.contains('is-readonly');
          if(isEdit) img.setAttribute('data-empty', '1');
          else img.removeAttribute('data-empty');
        }
      }
      _photoSlots[key] = src;
    },
    get: function(key){ return _photoSlots[key] || null; },
    getAll: function(){
      var result = {};
      document.querySelectorAll('img[data-photo]').forEach(function(img){
        result[img.dataset.photo] = img.src || null;
      });
      return result;
    }
  };
})();

// ── 写真への描画 (photo-draw-btn) ──
(function(){
  var drawers = {};
  function createPhotoDrawer(key){
    var imgEl = document.querySelector('img[data-photo="'+key+'"]');
    if(!imgEl||!imgEl.src||imgEl.getAttribute('data-empty')) return alert('先に写真をアップロードしてください');
    if(drawers[key]&&drawers[key].section){
      drawers[key].section.classList.add('is-drawing');
      document.body.classList.add('is-drawing-active');
      var _d=drawers[key].drawer;
      if(_d&&_d.refresh)requestAnimationFrame(function(){requestAnimationFrame(function(){_d.refresh();});});
      return;
    }
    var safeKey = key.replace(/[^a-zA-Z0-9\-_]/g, '');
    var section = document.createElement('section');
    section.className = 'photo-draw-section';
    section.innerHTML =
      '<div class="bm-canvas-wrap" style="position:relative;background:#000"><div id="pd-konva-'+safeKey+'"></div></div>'+
      '<div class="bm-toolbar">'+createToolbarHTML(null,{isPhoto:true,safeKey:safeKey})+
      '</div>'+
      '<div class="stamp-panel" id="pd-stamp-panel-'+safeKey+'" hidden>'+
        '<div class="stamp-panel-header"><button type="button" class="stamp-edit-toggle" id="pd-stamp-edit-'+safeKey+'">編集</button></div>'+
        '<div class="stamp-items" id="pd-stamp-items-'+safeKey+'"></div>'+
        '<button type="button" class="stamp-add-btn" id="pd-stamp-add-'+safeKey+'">＋ スタンプを登録</button>'+
      '</div>';
    document.body.appendChild(section);
    var bgImg = new Image();
    var _src = imgEl.src;
    if(_src && !_src.startsWith('data:')) bgImg.crossOrigin='anonymous';
    bgImg.src = _src;
    var drawer = createDrawer({
      container: section.querySelector('#pd-konva-'+safeKey),
      toolbar: section.querySelector('.bm-toolbar'),
      section: section,
      canvasWrap: section.querySelector('.bm-canvas-wrap'),
      doneBtn: section.querySelector('#pd-done-'+safeKey),
      srcImg: bgImg,
    });
    drawers[key]={section:section,drawer:drawer,imgEl:imgEl};
    // スタンプパネル結線
    var pdPanel=section.querySelector('#pd-stamp-panel-'+safeKey);
    var pdItems=section.querySelector('#pd-stamp-items-'+safeKey);
    var pdAddBtn=section.querySelector('#pd-stamp-add-'+safeKey);
    if(window.__PONCHI_STAMP_PANEL){
      window.__PONCHI_STAMP_PANEL(pdItems, pdAddBtn, function(st){
        if(drawer&&drawer.addStamp)drawer.addStamp(st.src);
        if(pdPanel)pdPanel.hidden=true;
      }, pdPanel);
    }
    section.querySelector('.bm-toolbar').addEventListener('click',function(e){
      var btn=e.target.closest('[data-tool="stamp"]');if(!btn)return;
      if(pdPanel)pdPanel.hidden=!pdPanel.hidden;
    });
    section.classList.add('is-drawing');
    document.body.classList.add('is-drawing-active');
    if(drawer&&drawer.refresh)requestAnimationFrame(function(){requestAnimationFrame(function(){drawer.refresh();});});
    section.querySelector('.bm-done-btn').addEventListener('click',function(){
      section.classList.remove('is-drawing');
      if(!document.querySelector('.draw-section.is-drawing,.photo-draw-section.is-drawing'))
        document.body.classList.remove('is-drawing-active');
      if(drawer&&drawer.exportImage){
        var url=drawer.exportImage();
        if(url&&imgEl){ imgEl.src=url; if(window.SaltyDogPonchiPhoto)SaltyDogPonchiPhoto.set(key,url); }
      }
    });
  }
  document.addEventListener('click',function(e){
    var btn=e.target.closest('.photo-draw-btn'); if(!btn)return;
    if(document.body.classList.contains('is-readonly'))return;
    createPhotoDrawer(btn.dataset.drawFor);
  });
  window.__PONCHI_GET_PHOTO_DRAWINGS = function(){
    var out={};
    Object.keys(drawers).forEach(function(k){
      var d=drawers[k];
      if(d.drawer&&d.drawer.exportImage) out[k]=d.drawer.exportImage();
    });
    return out;
  };
})();

// ── is-readonly 結線（契約#2） ──
document.addEventListener('DOMContentLoaded', function(){
  // スタンプパネル初期化（BM/TT drawer 完成後）
  if(window.__PONCHI_STAMP_RENDER) window.__PONCHI_STAMP_RENDER(window.__SALTYDOG_BM, window.__SALTYDOG_TEETH);
  // TC/TCN スタンプパネル初期化
  if(window.__PONCHI_STAMP_PANEL){
    var tcPanel=document.getElementById('tc-stamp-panel');
    var tcnPanel=document.getElementById('tcn-stamp-panel');
    var tcBar=document.getElementById('tc-toolbar');
    var tcnBar=document.getElementById('tcn-toolbar');
    window.__PONCHI_STAMP_PANEL(document.getElementById('tc-stamp-items'),document.getElementById('tc-stamp-add'),function(st){
      if(window.__SALTYDOG_TC&&window.__SALTYDOG_TC.addStamp)window.__SALTYDOG_TC.addStamp(st.src);
      if(tcPanel)tcPanel.hidden=true;
    },tcPanel);
    window.__PONCHI_STAMP_PANEL(document.getElementById('tcn-stamp-items'),document.getElementById('tcn-stamp-add'),function(st){
      if(window.__SALTYDOG_TCN&&window.__SALTYDOG_TCN.addStamp)window.__SALTYDOG_TCN.addStamp(st.src);
      if(tcnPanel)tcnPanel.hidden=true;
    },tcnPanel);
    if(tcBar)tcBar.addEventListener('click',function(e){var btn=e.target.closest('[data-tool="stamp"]');if(!btn)return;if(tcPanel)tcPanel.hidden=!tcPanel.hidden;});
    if(tcnBar)tcnBar.addEventListener('click',function(e){var btn=e.target.closest('[data-tool="stamp"]');if(!btn)return;if(tcnPanel)tcnPanel.hidden=!tcnPanel.hidden;});
  }
  if(window.__VIEW__){
    document.body.classList.add('is-readonly');
    var dlBtn=document.getElementById('dl-btn');
    if(dlBtn) dlBtn.style.display='block';
    var staffNote=document.getElementById('staffNoteBody');
    if(staffNote&&!staffNote.textContent.trim()) staffNote.closest('.staff-note-card').style.display='none';
    // contenteditable を全て false に
    document.querySelectorAll('[contenteditable]').forEach(function(el){
      el.contentEditable = 'false';
    });
    /* native 入力（ヒーロー日付・体重日付/数値など）も閲覧時は操作不可に */
    document.querySelectorAll('input, textarea, select').forEach(function(el){
      el.disabled = true;
    });
    // canvasWrap のクリックを capture phase で stopImmediatePropagation
    ['bm-canvas-wrap','tt-canvas-wrap'].forEach(function(id){
      var wrap = document.getElementById(id);
      if(wrap){
        wrap.addEventListener('click', function(e){
          e.stopImmediatePropagation();
        }, true);
      }
    });
  }
  if(window.PonchiApp) window.PonchiApp.boot();
  if(window.__REPORT__ && window.SaltyDogPonchi) window.SaltyDogPonchi.applyReport(window.__REPORT__);
  /* archiveBackBtn の結線は ponchi-app.js の renderArchiveScreen が onclick で設定するため
     ここでは設定しない（二重結線防止） */

  // ── 音声入力（Web Speech API）──
  (function(){
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var micBtns = document.querySelectorAll('.voice-mic-btn');
    if(!SR){
      micBtns.forEach(function(b){b.hidden=true;});
      return;
    }
    var activeRec = null, activeBtn = null;
    function stopCurrent(){
      if(activeRec){try{activeRec.abort();}catch(e){} activeRec=null;}
      if(activeBtn){activeBtn.classList.remove('is-recording');activeBtn.textContent='🎤 音声入力';activeBtn=null;}
    }
    micBtns.forEach(function(btn){
      var forId = btn.getAttribute('data-voice-for');
      btn.addEventListener('click', function(){
        if(activeBtn===btn){stopCurrent();return;}
        stopCurrent();
        var target = document.getElementById(forId) || document.querySelector('.'+forId);
        if(!target) return;
        var rec = new SR();
        rec.lang='ja-JP';
        rec.interimResults=false;
        rec.continuous=false;
        rec.onresult=function(e){
          var text=(e.results[0][0].transcript)||'';
          if(!text) return;
          target.focus();
          var sel=window.getSelection();
          var range=document.createRange();
          range.selectNodeContents(target);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
          if(!document.execCommand('insertText',false,text)){
            target.textContent+=text;
          }
        };
        rec.onerror=function(){stopCurrent();};
        rec.onend=function(){if(activeBtn===btn)stopCurrent();};
        activeRec=rec;
        activeBtn=btn;
        btn.classList.add('is-recording');
        btn.textContent='⏹ 停止';
        try{rec.start();}catch(e){stopCurrent();}
      });
    });
  })();
});
