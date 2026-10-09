let selection = {x:innerWidth/4,y:innerHeight/4,width:innerWidth/2,height:innerHeight/2}, start;
const box=document.getElementById('selection');
const paint=()=>{ for(const key of ['x','y','width','height']) box.style[{x:'left',y:'top',width:'width',height:'height'}[key]]=selection[key]+'px'; };
window.weftmateCapture.ready(data=>{document.getElementById('screen').src=data;paint();document.getElementById('confirm').focus();});
document.addEventListener('pointerdown',event=>{if(event.target.closest('.controls'))return;start={x:event.clientX,y:event.clientY};});
document.addEventListener('pointermove',event=>{if(!start)return;selection={x:Math.min(start.x,event.clientX),y:Math.min(start.y,event.clientY),width:Math.abs(event.clientX-start.x),height:Math.abs(event.clientY-start.y)};paint();});
document.addEventListener('pointerup',()=>{start=null;document.getElementById('confirm').focus();});
document.getElementById('confirm').onclick=()=>{if(selection.width>1&&selection.height>1)window.weftmateCapture.select(selection);};
document.getElementById('cancel').onclick=()=>window.weftmateCapture.select(null);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();window.weftmateCapture.select(null);return;}
if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();
const horizontal=['ArrowLeft','ArrowRight'].includes(event.key),key=event.shiftKey?horizontal?'width':'height':horizontal?'x':'y';
selection[key]+=['ArrowLeft','ArrowUp'].includes(event.key)?-10:10;
selection.x=Math.max(0,Math.min(innerWidth-2,selection.x));selection.y=Math.max(0,Math.min(innerHeight-2,selection.y));
selection.width=Math.max(2,Math.min(innerWidth-selection.x,selection.width));selection.height=Math.max(2,Math.min(innerHeight-selection.y,selection.height));paint();});
