/* Authored SVG geometry shared by cards, detail headers and trends. No chart dependency. */
(() => {
  let sequence=0;
  const finite=n=>typeof n==='number'&&Number.isFinite(n),clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,n));
  const node=(tag,attrs={},text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs))n.setAttribute(key,String(value));if(text!==undefined)n.textContent=text;return n;};
  const svg=(kind,height=66,empty=false)=>node('svg',{viewBox:`0 0 300 ${height}`,class:`health-graphic health-graphic-${kind}`,'aria-hidden':'true','data-empty':empty});
  const rect=(x,y,width,height,cls='health-graphic-track')=>node('rect',{x,y,width:Math.max(0,width),height,rx:height/2,class:cls});
  const marker=(x,y=30)=>node('circle',{cx:clamp(x,7,293),cy:y,r:6,class:'health-graphic-marker'});
  const label=(s,x,y,anchor='start')=>node('text',{x,y,'text-anchor':anchor,class:'health-graphic-label'},s);
  const percent=(value,min=0,max=100)=>finite(value)?clamp((value-min)/Math.max(1,max-min)*100):null;
  function band(value){const n=svg('band',100,!finite(value));
    for(const [i,name]of ['extreme','moderate','calm'].entries())n.append(rect(2+i*100,40,96,34,`health-graphic-zone health-graphic-grow health-stress-${name}`));
    if(finite(value)){const x=10+280*percent(value)/100;n.append(node('path',{d:`M${x} 17 L${x-9} 30 L${x+9} 30 Z`,class:'health-graphic-pointer'}),node('line',{x1:x,x2:x,y1:35,y2:80,class:'health-graphic-cursor'}));}
    n.append(label('0',2,99),label('100',298,99,'end'));return n;
  }
  function dualBars(actual,target){const n=svg('dual',110,!finite(actual)),ceiling=Math.max(1,finite(actual)?Math.max(0,actual):0,finite(target)?Math.max(0,target):0);
    for(const [i,value]of [actual,target].entries()){const y=8+i*56;n.append(rect(2,y,296,23));if(finite(value)&&value>0)n.append(rect(2,y,296*percent(value,0,ceiling)/100,23,i?'health-graphic-target health-graphic-grow':'health-graphic-fill health-graphic-grow'));}
    const time=v=>finite(v)?`${Math.floor(Math.round(v)/60)}h ${Math.round(v)%60}m`:'—';n.append(label(time(actual),2,51),label(`目标 ${time(target)}`,298,109,'end'));return n;
  }
  function range(value,low,high,min=0,max=100){const n=svg('range',66,!finite(value)),x=v=>8+284*percent(v,min,max)/100;n.append(rect(2,24,296,18));
    if(finite(low)&&finite(high)){const a=x(Math.min(low,high)),b=x(Math.max(low,high));n.append(rect(a,24,b-a,18,'health-graphic-fill health-graphic-grow'),node('line',{x1:a,x2:a,y1:20,y2:47,class:'health-graphic-tick'}),node('line',{x1:b,x2:b,y1:20,y2:47,class:'health-graphic-tick'}));}
    if(finite(value))n.append(marker(x(value),33));
    return n;
  }
  function halfGauge(value){const n=svg('half',110,!finite(value)),hit=finite(value)?Math.min(3,Math.floor(percent(value)/25)):-1;
    const position=ratio=>{const angle=Math.PI*(1-ratio);return [150+132*Math.cos(angle),102-82*Math.sin(angle)];};
    for(let i=0;i<4;i++){const a=position(i/4+.045),b=position((i+1)/4-.045);n.append(node('path',{d:`M${a[0]},${a[1]} A132 82 0 0 1 ${b[0]},${b[1]}`,class:`health-graphic-arc ${hit===i?'is-hit health-graphic-sweep':'health-graphic-inactive'} ${['health-stress-calm','health-stress-moderate','health-stress-high','health-stress-extreme'][i]}`,pathLength:1}));}
    if(finite(value)){const [x,y]=position(clamp(percent(value),2,98)/100);n.append(node('circle',{cx:x,cy:y,r:9,class:`health-graphic-marker ${['health-stress-calm','health-stress-moderate','health-stress-high','health-stress-extreme'][hit]}`}));}return n;
  }
  function fillPath(points,g,bottom=154){let path='',run=[];
    const close=()=>{if(run.length>1){path+=`M${g.x(run[0])},${bottom} L${run.map(i=>`${g.x(i)},${g.y(points[i].value)}`).join(' L')} L${g.x(run.at(-1))},${bottom} Z `;}run=[];};
    points.forEach((p,i)=>{if(finite(p.value))run.push(i);else close();});close();return path;
  }
  function gradient(svg,cls='health-gradient-color',opacity=.22){const id=`health-fill-${++sequence}`,defs=node('defs'),linear=node('linearGradient',{id,x1:0,y1:0,x2:0,y2:1});linear.append(node('stop',{offset:0,class:cls,'stop-opacity':opacity}),node('stop',{offset:1,class:cls,'stop-opacity':0}));defs.append(linear);svg.append(defs);return `url(#${id})`;}
  function area(samples=[]){const n=svg('area',124,!samples.some(p=>finite(p.value))),points=samples.map(p=>({value:finite(p.value)?clamp(p.value):null}));
    const g={x:i=>points.length<2?150:8+i*284/(points.length-1),y:v=>108-clamp(v)*.88};
    n.append(node('line',{x1:8,x2:292,y1:108,y2:108,class:'health-gridline'}));
    let path='';points.forEach((p,i)=>{if(finite(p.value))path+=`${i===0||!finite(points[i-1].value)?'M':'L'}${g.x(i)},${g.y(p.value)} `;});
    n.append(node('path',{d:fillPath(points,g,108),fill:gradient(n,'health-gradient-color',.32),class:'health-area-fill'}),node('path',{d:path,class:'health-line health-graphic-draw',pathLength:1}));
    const last=points.findLastIndex(p=>finite(p.value));if(last>=0)n.append(marker(g.x(last),g.y(points[last].value)));return n;
  }
  function comparison(value,actual){const n=svg('comparison',66,!finite(value)),max=Math.max(60,finite(value)?value*1.15:0,finite(actual)?actual*1.15:0),x=v=>8+284*percent(v,0,max)/100;
    n.append(rect(2,23,296,18));if(finite(value)){n.append(rect(2,23,x(value),18,'health-graphic-fill health-graphic-grow'),marker(x(value),32));}
    if(finite(actual)){n.append(node('line',{x1:x(actual),x2:x(actual),y1:17,y2:48,class:'health-graphic-tick'}),label(`实际 ${WeftHealth.value(actual)} 岁`,clamp(x(actual),48,250),63,'middle'));}return n;
  }
  function progress(value,peak){const n=svg('progress',24,!finite(value));n.append(rect(0,5,300,14));if(finite(value))n.append(rect(0,5,300*percent(value,0,finite(peak)?peak:Math.max(1,value))/100,14,'health-graphic-fill health-graphic-grow'));return n;}
  function stages(data={},total=null){data??={};const n=svg('stages',42),deep=data.deepMinutes,rem=data.remMinutes,awake=data.awakeMinutes,core=finite(total)&&finite(deep)&&finite(rem)?Math.max(0,total-deep-rem):null,values=[deep,core,rem,awake],known=values.filter(finite).reduce((a,b)=>a+Math.max(0,b),0),sum=Math.max(known,finite(data.inBedMinutes)?data.inBedMinutes:finite(total)?Math.max(0,total)+(finite(awake)?Math.max(0,awake):0):known);n.setAttribute('data-empty',known===0);let x=0;
    if(!known)n.append(rect(0,10,300,24));else {for(const [i,v]of values.entries()){if(!finite(v)||v<=0)continue;const width=Math.max(0,v)/sum*300;n.append(rect(x,10,Math.max(0,width-2),24,`health-stage-${['deep','core','rem','awake'][i]} health-graphic-grow`));x+=width;}if(x<300)n.append(rect(x,10,300-x,24));}return n;
  }
  function animateNumbers(root,{reducedMotion=false,request=globalThis.requestAnimationFrame,cancel=globalThis.cancelAnimationFrame,clock=()=>globalThis.performance.now(),onFinish=()=>{}}={}){if(reducedMotion)return ()=>{};
    const nodes=[...root.querySelectorAll('[data-count-to]')],started=clock();let frame;const tick=now=>{const progress=clamp((now-started)/400,0,1),eased=1-(1-progress)**3;for(const n of nodes)if(n.isConnected)n.textContent=WeftHealth.value(Number(n.dataset.countTo)*eased,n.dataset.countMetric);if(progress<1)frame=request(tick);else onFinish();};frame=request(tick);return ()=>cancel(frame);
  }
  const reducedMotion=()=>globalThis.WeftReplyMotion?.reduced===true||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
  const criticalStatus=data=>/明显(?:偏离|偏高|偏低)/.test(data?.label??'');
  function metricPalette(id,data={}){data??={};let name={fitnessAge:'fitness-age',hrvSdnnMs:'hrv',restingHeartRateBpm:'resting-heart-rate',respiratoryRateBrpm:'respiratory',spo2Pct:'oxygen',wristTempC:'temperature',activity:'load',sleepMinutes:'sleep',deepMinutes:'sleep',remMinutes:'sleep',awakeMinutes:'sleep',steps:'recovery',activeEnergyKcal:'energy-high',exerciseMinutes:'load',usageLateNightMinutes:'sleep',usageActiveMinutes:'load',vo2Max:'fitness-age'}[id]??id;
    if(id==='stress'){const v=data.score;name=finite(v)?`stress-${v<25?'calm':v<50?'moderate':v<75?'high':'extreme'}`:'stress-calm';}
    if(id==='energy'){const v=data.current??data.score;name=finite(v)?`energy-${v<30?'low':v<65?'mid':'high'}`:'energy-high';}return name;
  }
  globalThis.WeftHealthGraphics={band,dualBars,range,halfGauge,area,comparison,progress,stages,gradient,fillPath,percent,animateNumbers,reducedMotion,criticalStatus,metricPalette};
})();

/* Page-family presentation shared with the phone shell. Inline SVG contains only geometry. */
globalThis.WeftHealthView={mount({target,core,mobile=false,toast}){
  const H=WeftHealth,G=WeftHealthGraphics,m=core.health;let calendarOpen=false,expanded=false,basisOpen=false,moreWorkouts=false,selectedPoint=null,lastView=null,motionKey=null,displayDay=null,motionFrame=null;const methodOpen=new Set(),analysisBasis=new Set();
  const el=(tag,cls='',text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const action=(text,run,cls='health-control')=>{const n=el('button',cls,text);n.type='button';n.onclick=()=>Promise.resolve().then(run).catch(e=>toast?.(core.failureMessage(e)));return n;};
  const icon=(label,name,run)=>{const n=action('',run,'health-control health-icon');n.setAttribute('aria-label',label);n.title=label;n.append(WeftIcons.create(name,18));return n;};
  const small=text=>el('p','health-muted',text),card=(name)=>{const n=el('section','health-card');n.setAttribute('aria-label',name);n.append(el('h2','',name));return n;};
  const status=(data)=>el('span',`health-status is-${data?.state??'insufficient'}${G.criticalStatus(data)?' is-critical':''}`,data?.label??'再戴几天就有对比了');
  const svgEl=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
  function colorMetric(n,id,data={}){n.dataset.metric=id;const name=G.metricPalette(id,data);
    n.style.setProperty('--health-color',`var(--health-${name})`);n.style.setProperty('--health-color-soft',`var(--health-${name}-soft)`);return n;
  }
  function number(value,id,cls='health-big'){const wrap=el('div','health-score-number'),strong=el('strong',cls,H.value(value,id));if(H.finite(value)){strong.dataset.countTo=String(value);strong.dataset.countMetric=id;}wrap.append(strong,el('span','health-unit',H.metrics[id]?.[1]??''));return wrap;}
  function metricGraphic(id,data={}){if(id==='recovery')return G.band(data.score);if(id==='sleep')return G.dualBars(data.minutes,data.targetMinutes);if(id==='stress')return G.halfGauge(data.score);if(id==='energy')return data.degraded?G.area([]):G.area(data.curve??[]);if(id==='fitnessAge')return G.comparison(data.fitnessAge,data.actualAge);return loadGauge(data);}
  function conclusion(id,data={}){if(data.state==='insufficient')return '再戴几天就有对比了';if(['normal','balanced'].includes(data.state))return {recovery:'恢复状态平稳',sleep:'昨晚睡得不错',load:'今天的负荷刚好',stress:'今天的压力较平稳',energy:'今天还有余力'}[id]??data.label??'看看今天的变化';return data.label??'看看今天的变化';}
  function plot(series,usage=null,compact=false){
    const points=series?.points??[],g=H.chart(points,series?.average),wrap=colorMetric(el('div',`health-plot${compact?' is-compact':''}`),series?.id??m.metric,m.overview?.[series?.id??m.metric]),svg=svgEl('svg',{viewBox:'0 0 320 180',role:'img','aria-label':`${H.metrics[series?.id]?.[0]??'健康'}趋势，断线表示当天没有测量`});
    if(g.empty){wrap.append(small(series?.outsideRange?'最近能读取的趋势没有覆盖这个日期，先回到今天看看。':'这段时间还没有可显示的测量，之后的变化会显示在这里。'));return wrap;}
    for(const y of [22,88,154])svg.append(svgEl('line',{x1:16,x2:304,y1:y,y2:y,class:'health-gridline'}));
    if(g.band)svg.append(svgEl('path',{d:g.band,class:'health-range'}));
    const usageByDay=new Map((usage?.points??[]).map(p=>[p.day,p.value])),usageValues=[...usageByDay.values()].filter(H.finite),peak=Math.max(1,...usageValues);
    if(usage)points.forEach((p,i)=>{const n=usageByDay.get(p.day);if(H.finite(n))svg.append(svgEl('rect',{x:g.x(i)-Math.min(4,90/points.length),y:154-n/peak*66,width:Math.min(8,180/points.length),height:n/peak*66,class:'health-usage-bar'}));});
    if(H.finite(series.average))svg.append(svgEl('line',{x1:16,x2:304,y1:g.y(series.average),y2:g.y(series.average),class:'health-average'}));
    svg.append(svgEl('path',{d:G.fillPath(points,g),fill:G.gradient(svg),class:'health-area-fill'}),svgEl('path',{d:g.path,class:'health-line health-graphic-draw',pathLength:1}));
    const last=points.findLastIndex(p=>H.finite(p.value));if(last>=0){svg.append(svgEl('circle',{cx:g.x(last),cy:g.y(points[last].value),r:4,class:'health-point'}));const text=svgEl('text',{x:g.x(last)-6,y:Math.max(14,g.y(points[last].value)-12),'text-anchor':last>points.length/2?'end':'start',class:'health-last-value'});text.textContent=H.value(points[last].value,series.id);svg.append(text);}const selected=svgEl('circle',{r:5,class:'health-point health-selected-point',visibility:'hidden'});svg.append(selected);wrap.append(svg);
    if(!compact){const tip=el('div','health-chart-tip');tip.setAttribute('role','status');tip.setAttribute('aria-live','polite');
      function show(i){selectedPoint=Math.max(0,Math.min(points.length-1,i));const p=points[selectedPoint],minutes=usageByDay.get(p.day);tip.textContent=`${dateLabel(p.day)} · ${H.value(p.value,series.id)} ${H.metrics[series.id]?.[1]??''}${usage?` · 深夜使用 ${H.value(minutes)} 分钟`:''}`;tip.hidden=false;selected.setAttribute('visibility',H.finite(p.value)?'visible':'hidden');if(H.finite(p.value)){selected.setAttribute('cx',g.x(selectedPoint));selected.setAttribute('cy',g.y(p.value));}}
      tip.hidden=true;svg.tabIndex=0;svg.setAttribute('role','application');svg.setAttribute('aria-label','趋势图，按左右方向键查看每天的值');
      const at=e=>Math.round(((e.clientX-svg.getBoundingClientRect().left)/svg.getBoundingClientRect().width*320-16)/288*(points.length-1));
      svg.onpointerdown=e=>{svg.setPointerCapture?.(e.pointerId);show(at(e));};svg.onpointermove=e=>{if(e.buttons||e.pointerType==='mouse')show(at(e));};
      svg.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();show(e.key==='Home'?0:e.key==='End'?points.length-1:(selectedPoint??points.length-1)+(e.key==='ArrowLeft'?-1:1));}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();tip.hidden=true;selectedPoint=null;selected.setAttribute('visibility','hidden');}};
      if(selectedPoint!==null)show(selectedPoint);wrap.append(tip);
      const dates=el('div','health-chart-dates');dates.append(el('span','',dateLabel(points[0].day)),el('span','',dateLabel(points.at(-1).day)));wrap.append(dates);
      wrap.append(small(`实线：${H.metrics[series.id]?.[0]??'当前指标'} · 色带：${series.referenceRange?'公开参考范围':'你平时的范围'} · 虚线：平均${usage?' · 灰柱：深夜使用':''}`));
      if(usage)wrap.append(small(usageValues.length?`深夜使用柱最高 ${H.value(Math.max(...usageValues))} 分钟`:'这段时间还没有深夜使用记录，可以先看当前指标的变化。'));
    }return wrap;
  }
  function dateLabel(day){if(!day)return '今天';if(day===m.today)return '今天';const p=day.split('-');return `${Number(p[1])}月${Number(p[2])}日`;}
  function timeLabel(time){if(!time)return '—';const d=new Date(time);if(!Number.isFinite(d.getTime()))return '—';return new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:m.trend?.timeZone??m.weekSleep?.timeZone}).format(d);}
  function gauge(score,low=null,high=null,colored=false){const wrap=el('div','health-gauge'),svg=svgEl('svg',{viewBox:'0 0 300 28','aria-hidden':'true'});
    svg.append(svgEl('rect',{x:0,y:10,width:300,height:8,rx:4,class:'health-range'}));
    if(colored)for(const [i,cls]of ['health-zone','health-mid-zone','health-high-zone'].entries())svg.append(svgEl('rect',{x:i*100,y:10,width:100,height:8,rx:4,class:cls}));
    if(H.finite(low)&&H.finite(high))svg.append(svgEl('rect',{x:Math.max(0,low)*3,y:10,width:Math.max(0,Math.min(100,high)-Math.max(0,low))*3,height:8,rx:4,class:'health-zone'}));
    if(H.finite(score)){const x=Math.max(4,Math.min(296,score*3));svg.append(svgEl('path',{d:`M${x-4} 0 L${x+4} 0 L${x} 7 Z`,class:'health-marker'}));}wrap.append(svg);return wrap;}
  function loadGauge(data){const range=data?.recommendedRange;if(!H.finite(range?.low)||!H.finite(range?.high))return G.range(data?.score,data?.low,data?.high);const ceiling=Math.max(100,data.daily??0,range.high*1.1);return G.range(data.daily,range.low,range.high,0,ceiling);}
  function loadRange(data){const range=data?.recommendedRange;return H.finite(range?.low)&&H.finite(range?.high)?`今天 ${H.value(data.daily)} · 建议 ${H.value(range.low)}–${H.value(range.high)}（相对负荷）`:H.finite(data?.low)?`你平时 ${H.value(data.low)}–${H.value(data.high)}`:'再戴几天就有对比了';}
  function insightCard(collapsible=false){
    const data=m.overview?.insight,n=card('今日解读');n.querySelector('h2').prepend(WeftIcons.create('health',18));
    if(!data){n.append(el('h3','','这一天还没有足够的记录'),small('有了睡眠和活动记录，就能把当天的变化讲给你听。'));return n;}
    const body=el('div','health-insight-body');body.hidden=collapsible&&!expanded;
    if(collapsible){const toggle=action(data.headline,()=>{expanded=!expanded;WeftAuxiliaryMotion.expand(body,expanded,toggle);},'health-insight-toggle');toggle.append(WeftIcons.create('chevron',18));toggle.setAttribute('aria-expanded',String(expanded));n.append(toggle);}else n.append(el('h3','',data.headline));
    body.append(el('p','health-reading is-expanded',data.text));
    for(const suggestion of (data.suggestions??[]).slice(0,2)){const row=el('div','health-suggestion'),saved=m.reminders.has(suggestion.id),b=action(saved?'已设提醒':m.busy.has(suggestion.id)?'正在设置…':'提醒我',()=>core.remindHealth(suggestion));
      b.classList.add('health-remind');b.disabled=saved||m.busy.has(suggestion.id)||!suggestion.reminder||m.day!==m.today;if(!suggestion.reminder)b.title='这条建议没有指定提醒时间';row.append(el('span','',suggestion.text),b);body.append(row);}
    const foot=el('div','health-insight-foot');
    if(data.observations?.length){const evidence=el('div','health-basis');evidence.hidden=!basisOpen;
      evidence.append(small(`依据：${[...new Set(data.observations.flatMap(o=>o.inputs??[]))].map(id=>H.metrics[id]?.[0]??({lateNightMinutes:'深夜使用时长',activeMinutes:'电脑使用时长'}[id]??'每日汇总')).join('、')}`));for(const o of data.observations)evidence.append(small(o.text));
      const basis=action(basisOpen?'收起解读':'展开解读',()=>{basisOpen=!basisOpen;basis.textContent=basisOpen?'收起解读':'展开解读';WeftAuxiliaryMotion.expand(evidence,basisOpen,basis);});basis.setAttribute('aria-expanded',String(basisOpen));foot.append(basis);body.append(evidence);}
    foot.append(action('接着问它',()=>core.askHealth()));body.append(foot);n.append(body);return n;
  }
  function metricButton(id,data={}){data??={};const n=colorMetric(action('',()=>core.openHealthMetric(id,'detail'),'health-metric health-card'),id,data);n.setAttribute('aria-label',H.metrics[id][0]+'，查看详情');
    const value=id==='fitnessAge'?data.fitnessAge:id==='energy'?data.current:data.score;n.setAttribute('aria-description',H.finite(value)?`${H.value(value,id)} ${H.metrics[id][1]}，${data.label??''}`:id==='fitnessAge'?H.profileHint(data):data.label??'当天还没有测量');const name=el('span','health-card-name',H.metrics[id][0]);name.append(WeftIcons.create('right',14));n.append(name,number(value,id));
    const state=status(data);if(!H.finite(value)){state.textContent=id==='fitnessAge'?'资料不足':data.state==='insufficient'?'记录不足':'暂无测量';state.title=id==='fitnessAge'?H.profileHint(data):data.label??'继续记录，就能看到自己的变化';}n.append(state,metricGraphic(id,data));
    if(id==='fitnessAge'&&H.finite(data.difference)){const capsule=el('span','health-age-capsule',ageDifference(data));n.append(capsule);}
    if(id==='stress')n.append(small(data.latest?.time?'最近测量 '+timeLabel(data.latest.time):'等待下一次测量'));
    if(id==='energy'&&data.degraded)n.append(small('当前记录较少'));
    return n;
  }

  function methodNote(id){const wrap=el('div','health-method'),open=methodOpen.has(id),name={stress:'Baevsky 压力指数',energy:'充放电模型',fitnessAge:'最大摄氧量参考值'}[id];
    const b=action('依据',()=>{open?methodOpen.delete(id):methodOpen.add(id);render();},'health-control health-method-toggle');b.prepend(WeftIcons.create('info',14));b.setAttribute('aria-expanded',String(open));wrap.append(b);if(open)wrap.append(small(name));return wrap;
  }

  function intraday(id,data,compact=false){const samples=id==='stress'?data.samples??[]:data.curve??[],wrap=el('div',`health-plot health-intraday${compact?' is-compact':''}`);
    if(id==='energy'&&data.degraded===true){wrap.append(small('当前记录较少，暂时没有曲线。'));return wrap;}
    const points=samples.map(p=>({value:p.value})),g=H.chart(points),svg=svgEl('svg',{viewBox:'0 0 320 180',role:'img','aria-label':id==='stress'?'当天各次压力测量':'当日电能曲线，淡色区域表示睡眠'});
    if(g.empty){if(!compact)wrap.append(small('当天还没有足够的测量点。'));return wrap;}
    if(id==='energy'){const first=H.clockMinutes(samples[0].time),last=H.clockMinutes(samples.at(-1).time),span=last-first||1;for(const sleep of data.sleepPeriods??[]){const a=H.clockMinutes(sleep.start),b=H.clockMinutes(sleep.end);for(const [from,to]of b<a?[[0,b],[a,1440]]:[[a,b]]){const start=Math.max(16,16+(from-first)/span*288),end=Math.min(304,16+(to-first)/span*288);if(end>start)svg.append(svgEl('rect',{x:start,y:16,width:end-start,height:138,class:'health-sleep-band'}));}}svg.append(svgEl('path',{d:G.fillPath(points,g),fill:G.gradient(svg),class:'health-area-fill'}),svgEl('path',{d:g.path,class:'health-line health-graphic-draw',pathLength:1}));}
    for(const y of [22,88,154])svg.append(svgEl('line',{x1:16,x2:304,y1:y,y2:y,class:'health-gridline'}));
    const latest=samples.findLastIndex(p=>H.finite(p.value));samples.forEach((p,i)=>{if(H.finite(p.value)&&(id==='stress'||i===latest))svg.append(svgEl('circle',{cx:g.x(i),cy:g.y(p.value),r:compact?3:4,class:'health-point'}));});wrap.append(svg);
    if(!compact){const dates=el('div','health-chart-dates');dates.append(el('span','',id==='energy'?samples[0].time:timeLabel(samples[0].time)),el('span','',id==='energy'?samples.at(-1).time:timeLabel(samples.at(-1).time)));wrap.append(dates);const list=el('div','health-measurements');for(const p of samples){const row=el('span','',`${timeLabel(p.time)} · ${H.value(p.value)} 分`);list.append(row);}if(id==='stress')wrap.append(list);else wrap.append(small('淡色区域：睡眠时段；空白表示没有测量或今天尚未到来的时段'));}return wrap;
  }
  function estimateCard(id,data){return metricButton(id,data);}

  function ageDifference(data){if(!H.finite(data.difference))return '戴着手表继续记录，看看自己的变化';const difference=Math.round(data.difference);return difference===0?'与实际年龄相同':`比实际年龄${difference<0?'小':'大'} ${Math.abs(difference)} 岁`;}
  function analysisRow(scope){const wrap=el('div','health-analysis');if(!scope||!Object.hasOwn(m.settings??{},'itemAnalysisEnabled'))return wrap;
    const open=m.analysisOpen.has(scope),data=m.analyses.get(scope),enabled=m.settings.itemAnalysisEnabled,first=data?.text?.split(/[。！？\n]/)[0],b=action(data?`${first}。`:'让 AI 分析这一项',()=>core.toggleHealthAnalysis(scope),'health-control health-analysis-toggle');b.append(WeftIcons.create('chevron',16));b.setAttribute('aria-expanded',String(open));b.setAttribute('aria-label',data?'展开这一项的 AI 分析':'让 AI 分析这一项');wrap.append(b);if(!open)return wrap;
    const body=el('div','health-analysis-body');if(m.analysisBusy.has(scope))body.append(skeleton('正在分析这一项'));
    else if(data){body.append(el('p','health-reading is-expanded',data.text));for(const point of data.points??[])body.append(small(point));const foot=el('div','health-insight-foot'),basis=action('依据',()=>{analysisBasis.has(scope)?analysisBasis.delete(scope):analysisBasis.add(scope);render();});basis.setAttribute('aria-expanded',String(analysisBasis.has(scope)));foot.append(action('接着问它',()=>core.askHealthAnalysis(scope)),basis);body.append(foot);if(analysisBasis.has(scope))body.append(small(`依据：${(data.basis??[]).join('、')||'这一项的每日汇总'}`));}
    else {const kind=m.analysisErrors.get(scope);const messages={off:'各项的 AI 分析已关闭。可以重新打开。',limit:'今天分析的次数已经用完了，明天再来看看。',offline:'电脑暂时不在线，连接后再试。',failed:'这次没能完成分析，请再试一次。'};
      if(kind){const note=small(messages[kind]);note.setAttribute('role','status');body.append(note);}
      if(!enabled){body.append(small('会把这一项每天的汇总数字发给你设置的模型，不发明细；随时可以在设置里关掉'),action('打开 AI 分析',()=>core.enableHealthAnalysis(scope)));}
      else if(kind!=='limit')body.append(action('重新分析',()=>core.generateHealthAnalysis(scope)));}
    wrap.append(body);return wrap;
  }
  function extraDetail(){const id=m.metric,o=m.overview,data=H.vitals.includes(id)?H.vital(o,id)??{}:o[id]??{},wrap=el('div','health-detail'),hero=colorMetric(card(H.metrics[id][0]),id,data);hero.classList.add('health-detail-hero');
    if(id==='activity'){hero.append(el('h3','health-conclusion','今天的活动'),activityNumbers(data));}
    else if(id==='fitnessAge'&&(data.state==='insufficient'||!H.finite(data.fitnessAge)))hero.append(el('h3','health-conclusion','还需要一点记录'),small(H.profileHint(data)),metricGraphic(id,data));
    else {hero.append(el('h3','health-conclusion',conclusion(id,data)),number(H.vitals.includes(id)?data.value:id==='fitnessAge'?data.fitnessAge:id==='energy'?data.current:data.score,id,'health-hero-number'),status(data));
      if(id==='fitnessAge')hero.append(el('span','health-age-capsule',ageDifference(data)),metricGraphic(id,data));
      else if(H.vitals.includes(id))hero.append(vitalRange(data),small(H.finite(data.low)?'你平时 '+H.value(data.low,id)+'–'+H.value(data.high,id)+' '+H.metrics[id][1]:'再戴几天就有对比了'));
      else hero.append(metricGraphic(id,data));
    }
    if(id==='stress')hero.append(small(data.latest?.time?'最近一次测量 '+timeLabel(data.latest.time):'当天还没有有效测量'));
    wrap.append(hero);
    if(['stress','energy','fitnessAge'].includes(id)){const below=colorMetric(card(id==='fitnessAge'?'与自己的年龄对照':'今天的变化'),id,data);
      if(id==='stress'||id==='energy'){const compare=el('div','health-comparisons');for(const [name,value]of id==='stress'?[['当天平均',data.average],['近 14 天平均',m.scoreAverages[id]]]:[['夜间充了多少',data.nightCharged],['白天耗了多少',data.dayDrained]]){const cell=el('div');cell.append(small(name),number(value,id,'health-medium'));compare.append(cell);}below.append(compare,intraday(id,data));}
      if(id==='stress')below.append(small('手表每隔几小时测一次，这不是每分钟更新的数值'));
      if(id==='fitnessAge'){const compare=el('div','health-comparisons');for(const [name,value,key]of [['实际年龄',data.actualAge,'fitnessAge'],['最大摄氧量',data.vo2Max,'vo2Max']]){const cell=el('div');cell.append(small(name),number(value,key,'health-medium'));compare.append(cell);}below.append(compare);if(H.finite(data.referenceRange?.low)&&H.finite(data.referenceRange?.high))below.append(small('最大摄氧量参考范围 '+H.value(data.referenceRange.low,'vo2Max')+'–'+H.value(data.referenceRange.high,'vo2Max')+' 毫升/千克/分'));}
      below.append(methodNote(id),analysisRow(H.analysisScope(id)));wrap.append(below);
    }else hero.append(analysisRow(H.analysisScope(id)));return wrap;
  }
  function vitalRange(data={}){const range=H.finite(data.low)&&H.finite(data.high),span=range?Math.max(1,data.high-data.low):1,graphic=G.range(data.value,range?data.low:null,range?data.high:null,range?data.low-span*.5:0,range?data.high+span*.5:Math.max(100,data.value??0));graphic.style.setProperty('--health-dot-color',!range?'var(--health-muted)':data.value>=data.low&&data.value<=data.high?'var(--health-good)':'var(--health-warning)');return graphic;}
  function activityNumbers(data={}){const numbers=el('div','health-activity-numbers');for(const id of ['steps','activeEnergyKcal','exerciseMinutes']){const range=m.dimensionMetrics[id],peak=H.finite(range?.high)?range.high:range?.baseline,b=colorMetric(action('',()=>core.openHealthMetric('activity','detail'),'health-activity-value'),id==='steps'?'recovery':id==='activeEnergyKcal'?'energy':'load',id==='activeEnergyKcal'?{current:80}:{});b.append(el('span','',H.metrics[id][0]),number(data[id],id,'health-medium'),G.progress(H.finite(peak)?data[id]:null,peak));if(!H.finite(data[id]))b.append(small('当天还没有记录'));numbers.append(b);}return numbers;}
  function sleepDuration(minutes){const n=el('div','health-duration');if(!H.finite(minutes)){n.append(el('strong','health-big','—'));return n;}const value=Math.round(minutes);n.append(el('strong','health-big',String(Math.floor(value/60))),el('span','health-unit','小时'),el('strong','health-big',String(value%60)),el('span','health-unit','分'));return n;}

  function todayContent(){const o=m.overview,column=el('div','health-today');column.append(insightCard());const scores=el('div','health-scores');for(const id of ['recovery','sleep','load'])scores.append(metricButton(id,o[id]));for(const id of ['stress','energy','fitnessAge'])if(o[id]!=null)scores.append(estimateCard(id,o[id]));column.append(scores);
    const sleep=colorMetric(card('昨晚的睡眠'),'sleep'),sleepGrid=el('div','health-sleep-summary'),facts=el('div');sleep.append(sleepDuration(o.sleep?.minutes),G.dualBars(o.sleep?.minutes,o.sleep?.targetMinutes));facts.append(small(timeLabel(o.sleep?.start)+' 入睡 — '+timeLabel(o.sleep?.end)+' 起床'),small('深睡 '+H.duration(m.sleepStages.deepMinutes)+' · 快速眼动 '+H.duration(m.sleepStages.remMinutes)));
    if(!H.finite(m.sleepStages.deepMinutes)&&!H.finite(m.sleepStages.remMinutes))facts.append(small(m.supplementLoading?'正在读取睡眠分期':m.stageError?'睡眠分期暂时读不到，可点右上角刷新再试。':'这一天还没有睡眠分期记录。'));
    if(!o.sleep?.start||!o.sleep?.end)facts.append(small('入睡和起床的时刻还没有完整记录。'));
    const usage=el('div','health-sleep-usage');usage.append(WeftIcons.create('desktop',18),el('h3','','昨晚的电脑使用'),el('strong','health-medium',H.finite(o.usage?.lateNightMinutes)?H.value(o.usage.lateNightMinutes)+' 分钟':'—'),small(o.usage?.lastUsedAt?'用到 '+timeLabel(o.usage.lastUsedAt):H.finite(o.usage?.lateNightMinutes)?'凌晨 1–5 点的使用估算':'还没有这一天的电脑使用记录。'));sleepGrid.append(facts,usage);sleep.append(sleepGrid);column.append(sleep);
    const vitals=card('身体指标'),list=el('div','health-vitals');for(const id of H.vitals){const data=H.vital(o,id),b=colorMetric(action('',()=>core.openHealthMetric(id,'detail'),'health-vital'),id,data);b.append(WeftIcons.create(H.metrics[id][2],20),el('span','health-vital-name',H.metrics[id][0]),number(data?.value,id,'health-medium'),vitalRange(data));const state=status(data);b.append(state);if(!H.finite(data?.value))b.append(small('当天还没有测量'));list.append(b);}vitals.append(list);column.append(vitals);
    const activity=card('今天的活动');activity.append(activityNumbers(o.activity),small(Object.values(m.dimensionMetrics).some(p=>H.finite(p?.high))?'彩条对照你平时的活动量':'继续记录，就能对照平时的活动量'));const workouts=o.activity?.workouts??[];for(const w of workouts.slice(0,moreWorkouts?workouts.length:3)){const row=el('div','health-workout');row.append(el('span','',w.type),el('span','',H.duration(w.minutes)));activity.append(row);}if(!workouts.length)activity.append(small('今天还没有运动记录，日常走动也会显示在上面。'));if(workouts.length>3){const b=action(moreWorkouts?'收起运动记录':'查看另外 '+(workouts.length-3)+' 条运动',()=>{moreWorkouts=!moreWorkouts;render();});b.setAttribute('aria-expanded',String(moreWorkouts));activity.append(b);}
    const dotGrid=el('div','health-activity-dots');dotGrid.setAttribute('aria-label','本月运动记录');for(const day of m.calendar?.days??[]){const dot=el('span',day.hasWorkout?'has-workout':'');dot.title=dateLabel(day.day)+(day.hasWorkout?' · 有运动':' · 没有运动记录');dotGrid.append(dot);}if(dotGrid.childElementCount)activity.append(dotGrid);column.append(activity);return column;
  }

  function trendPanel(){const n=colorMetric(card('趋势'),m.metric,m.overview?.[m.metric]);n.dataset.score=String(['recovery','sleep','load'].includes(m.metric));const caps=el('div','health-metric-tabs');caps.setAttribute('role','tablist');caps.setAttribute('aria-label','健康指标');
    for(const [id,[name]]of Object.entries(H.metrics).filter(([id])=>!['stress','energy','fitnessAge'].includes(id)||m.overview?.[id]!=null)){const b=action(name,()=>core.openHealthMetric(id,'trend'));b.setAttribute('role','tab');b.tabIndex=id===m.metric?0:-1;b.setAttribute('aria-selected',String(id===m.metric));caps.append(b);}caps.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();const tabs=[...caps.querySelectorAll('[role=tab]')],index=tabs.indexOf(document.activeElement),next=tabs[event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length];next.focus();next.click();};n.append(caps);
    const displayId=m.metric==='fitnessAge'?'vo2Max':m.metric==='activity'?'exerciseMinutes':m.metric,trend=m.trend,point=trend?.points.at(-1),summary=el('div','health-trend-value');summary.append(el('h3','',H.metrics[displayId][0]),el('strong','health-big',H.value(point?.value,displayId)),el('span','health-unit',H.metrics[displayId][1]));n.append(summary,status(point),small(H.finite(point?.low)&&H.finite(point?.high)?`你平时：${H.value(point.low,displayId)}–${H.value(point.high,displayId)} ${H.metrics[displayId][1]}`:'再戴几天就有对比了'));
    if(m.trendLoading)n.append(skeleton('正在读取趋势'));else if(m.trendError)n.append(errorState(m.trendError,()=>core.readHealthTrend()));else n.append(plot(m.metric==='fitnessAge'&&m.overview?.fitnessAge?.referenceRange?{...trend,referenceRange:true,points:(trend?.points??[]).map(p=>({...p,...m.overview.fitnessAge.referenceRange}))}:trend,m.overlay?m.usage:null));
    const segments=el('div','health-segments');segments.setAttribute('role','group');segments.setAttribute('aria-label','趋势天数');for(const days of [7,14,30,60]){const b=action(`${days}天`,()=>core.readHealthTrend(m.metric,days));b.setAttribute('aria-pressed',String(days===m.days));segments.append(b);}n.append(segments);
    const toggle=action('叠加：深夜使用时长',()=>core.healthOverlay(!m.overlay));toggle.setAttribute('role','switch');toggle.setAttribute('aria-checked',String(m.overlay));toggle.classList.add('health-overlay');toggle.prepend(WeftIcons.create(m.overlay?'allow':'desktop',16));n.append(toggle);
    n.append(small(point?.label?`${H.metrics[displayId][0]}${point.state==='normal'?'在你平时的范围内':`：${point.label}`}。先看连续几天的变化，不用只盯着一天。`:'有了更多记录，再一起看看这一项怎样变化。'));if(m.view==='trend')n.append(analysisRow(H.analysisScope(m.metric)));return n;
  }
  function detailContent(){if(['stress','energy','fitnessAge','activity',...H.vitals].includes(m.metric))return extraDetail();const id=m.metric,data=m.overview?.[id]??{},wrap=el('div','health-detail'),hero=colorMetric(card(H.metrics[id][0]),id,data);hero.classList.add('health-detail-hero');hero.append(el('h3','health-conclusion',conclusion(id,data)),number(data.score,id,'health-hero-number'),metricGraphic(id,data));if(id==='load')hero.append(small(loadRange(data)));wrap.append(hero);
    const comparisons=colorMetric(card('和自己比较'),id,data),grid=el('div','health-comparisons'),average=m.scoreAverages[id];for(const [name,value]of [['近 14 天平均',average],[id==='sleep'?'目标时长':'你平时',id==='sleep'?data.targetMinutes:data.baseline]]){const cell=el('div');cell.append(small(name),id==='sleep'&&name==='目标时长'?sleepDuration(value):number(value,id,'health-medium'));grid.append(cell);}comparisons.append(grid);for(const reason of data.reasons??[])comparisons.append(small(reason.text));comparisons.append(analysisRow(id));wrap.append(comparisons,insightCard(true));
    if(id==='sleep'){const stages=colorMetric(card('睡眠分期'),'sleep');stages.classList.add('health-stages');stages.append(G.stages(m.sleepStages,data.minutes));const legend=el('div','health-stage-legend');for(const [name,key]of [['深睡','deepMinutes'],['核心','coreMinutes'],['快速眼动','remMinutes'],['清醒','awakeMinutes']]){const value=key==='coreMinutes'?H.finite(data.minutes)&&H.finite(m.sleepStages.deepMinutes)&&H.finite(m.sleepStages.remMinutes)?Math.max(0,data.minutes-m.sleepStages.deepMinutes-m.sleepStages.remMinutes):null:m.sleepStages[key];const item=el('span','health-stage-'+key);item.append(el('i'),el('span','',name+' '+H.duration(value)));legend.append(item);}stages.append(legend,small('色带按各分期的时长比例显示'));wrap.append(stages);}
    const dims=colorMetric(card('看看各项变化'),id,data),ids=id==='recovery'?['hrvSdnnMs','restingHeartRateBpm','sleepMinutes']:id==='sleep'?['sleepMinutes','deepMinutes','remMinutes','awakeMinutes']:['exerciseMinutes','activeEnergyKcal','steps'];
    for(const key of ids){const data=H.vital(m.overview,key)??m.dimensionMetrics[key],value=data?.value??({sleepMinutes:m.overview.sleep?.minutes,deepMinutes:m.sleepStages.deepMinutes,remMinutes:m.sleepStages.remMinutes,awakeMinutes:m.sleepStages.awakeMinutes,...m.overview.activity}[key]);const b=action('',()=>core.openHealthMetric(key),'health-dimension');b.append(el('span','',H.metrics[key][0]),el('strong','',H.value(value,key)+' '+H.metrics[key][1]),data?.label?status(data):small(H.finite(value)?(m.dimensionLoading?'正在读取对比…':'暂时没有对比'):'当天还没有测量'));b.append(H.finite(data?.low)&&H.finite(data?.high)?vitalRange(data):G.progress(value,key==='sleepMinutes'?m.overview.sleep.targetMinutes:Math.max(1,value??1)));dims.append(b);}wrap.append(dims);return wrap;
  }

  function weekCard(){const n=colorMetric(card('这周：健康 × 使用'),'sleep');n.classList.add('health-week');const observation=m.overview.insight?.observations?.find(o=>(o.inputs??[]).includes('sleepMinutes')&&(o.inputs??[]).some(id=>['usageLateNightMinutes','lateNightMinutes'].includes(id)));const has=m.weekSleep?.points.some(p=>H.finite(p.value));n.append(small(has?`近 7 天平均睡眠 ${H.duration(m.weekSleep.average)}${H.finite(m.weekUsage?.average)?`，深夜使用平均 ${H.value(m.weekUsage.average)} 分钟`:''}。把两条记录放在一起，看看自己的节奏。`:'还没有足够的睡眠记录，之后会在这里汇总这一周。'),plot(m.weekSleep,m.weekUsage));if(observation)n.append(small(observation.text));return n;}
  const skeleton = () => WeftControls.skeleton();
  function errorState(message,retry){const n=el('div','health-error');n.setAttribute('role','alert');n.append(WeftIcons.create('health',28),el('h3','','暂时读不到健康记录'),small(message),action('重试',retry));return n;}
  function disconnected(){const n=card('还没有健康记录');n.classList.add('health-empty');n.prepend(WeftIcons.create('health',24));n.append(small('在 iPhone 上打开 WeftMate，接入健康数据后，就能在这里查看睡眠、恢复和活动的变化。'),small('健康数据只保存在你自己的设备上。'));return n;}
  function calendar(){const n=el('div','health-calendar');n.setAttribute('role','region');n.setAttribute('aria-label','健康月历');const head=el('div','health-heading');const monthMove=offset=>{const d=new Date(`${m.month}-01T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+offset);return core.readHealthCalendar(d.toISOString().slice(0,7));};const next=icon('下个月','right',()=>monthMove(1));next.disabled=m.month>=m.today.slice(0,7);head.append(icon('上个月','back',()=>monthMove(-1)),el('h2','',`${Number(m.month.slice(0,4))}年${Number(m.month.slice(5))}月`),next,icon('收起月历','deny',()=>{calendarOpen=false;render();}));n.append(head);
    if(m.calendarLoading)n.append(skeleton('正在读取月历'));else if(m.calendarError)n.append(errorState(m.calendarError,()=>core.readHealthCalendar()));else{const grid=el('div','health-calendar-grid');for(const name of ['一','二','三','四','五','六','日'])grid.append(el('span','health-muted',name));const start=(new Date(`${m.month}-01T12:00:00Z`).getUTCDay()+6)%7;for(let i=0;i<start;i++)grid.append(el('span'));for(const day of m.calendar?.days??[]){const b=action(String(Number(day.day.slice(-2))),async()=>{calendarOpen=false;await core.readHealth(day.day);});b.setAttribute('aria-label',`${dateLabel(day.day)}${day.hasWorkout?'，有运动':''}`);b.setAttribute('aria-pressed',String(day.day===m.day));b.disabled=day.day>m.today;if(day.hasWorkout)b.append(el('span','health-calendar-dot'));grid.append(b);}n.append(grid,small('日期下的小点表示当天有运动记录。'));}return n;
  }
  const header=el('div','health-heading'),title=el('h1','','健康'),nav=el('div','health-date-nav'),content=el('div','health-content');title.tabIndex=-1;
  const refresh=icon('刷新健康','sync',()=>core.readHealth()),back=action('返回今日',()=>{m.view='today';selectedPoint=null;render();});
  const previous=icon('前一天','back',()=>core.readHealth(H.dayShift(m.day,-1))),next=icon('后一天','right',()=>core.readHealth(H.dayShift(m.day,1))),today=icon('回到今天','clock',()=>core.readHealth(m.today));
  const date=action('',()=>{calendarOpen=!calendarOpen;if(calendarOpen)void core.readHealthCalendar();render();});date.setAttribute('aria-label','选择健康日期');
  header.append(title,nav);target.replaceChildren(header,content);let contentSignature='';
  function render(){const viewChanged=lastView!==m.view;lastView=m.view;
    target.classList.add('health-page');target.classList.toggle('health-mobile',mobile);const compact=mobile||globalThis.matchMedia('(max-width:600px)').matches;target.classList.toggle('is-compact',compact);
    refresh.disabled=m.loading;previous.disabled=!m.day||m.loading;next.disabled=!m.day||m.day>=m.today||m.loading;
    const dateText=!m.day?'选择日期':m.day===m.today?`今天 · ${Number(m.day.slice(5,7))}月${Number(m.day.slice(8))}日`:dateLabel(m.day);if(date.textContent!==dateText)date.textContent=dateText;date.setAttribute('aria-expanded',String(calendarOpen));
    WeftControls.reconcile(nav,[...(m.view==='today'?[previous,date,next]:[back,date]),refresh,...(m.day&&m.day!==m.today?[today]:[])]);
    content.setAttribute('aria-busy',String(m.loading));
    // Polling retains the current content until a new snapshot is ready.
    if(m.loading&&m.overview&&content.childElementCount)return;
    const signature=JSON.stringify([m,calendarOpen,expanded,basisOpen,moreWorkouts,[...methodOpen],[...analysisBasis],compact],(_key,value)=>value instanceof Map||value instanceof Set?[...value]:value);
    if(contentSignature===signature)return;contentSignature=signature;motionFrame?.();
    const focus=document.activeElement,focusName=content.contains(focus)?focus.getAttribute('aria-label')||focus.textContent:null;
    const paint=()=>{
    content.replaceChildren();if(calendarOpen)content.append(calendar());
    if(m.error&&!m.overview){content.append(errorState(m.error,()=>core.readHealth()));}else if(!m.overview){content.append(skeleton('正在读取健康'));}else if(!m.overview.connected){content.append(disconnected());}else{
      if(m.error){const warning=el('div','health-refresh-error');warning.setAttribute('role','status');warning.append(small('更新失败，仍显示上次的记录。'),action('重试',()=>core.readHealth()));content.append(warning);}
      const layout=el('div',`health-layout is-${m.view}`);if(m.view==='today')layout.append(todayContent());else if(m.view==='detail')layout.append(detailContent());else if(!mobile&&globalThis.matchMedia('(min-width:901px)').matches)layout.append(todayContent());const trend=trendPanel();trend.classList.add('health-trend-panel');if(m.view!=='today'||!mobile)layout.append(trend);content.append(layout);if(m.view==='today'&&!mobile)content.append(weekCard());
      content.append(small(m.overview.updatedAt?`数据更新于 ${timeLabel(m.overview.updatedAt)}`:'这一天还没有记录。'));
    }
    };
    if(globalThis.WeftMotion?.transition)WeftMotion.transition(content,paint,{key:`${m.day}/${m.view}/${m.metric}`});else paint();
    if(viewChanged){const scroller=mobile?document.getElementById('generic-page'):target;if(scroller)scroller.scrollTop=0;}
    if(focusName){const replacement=[...target.querySelectorAll('button')].find(n=>(n.getAttribute('aria-label')||n.textContent)===focusName);replacement?.focus({preventScroll:true});}
    const key=`${m.day}/${m.view}/${m.metric}`;const reduced=G.reducedMotion()||globalThis.WeftReplyMotion?.paused===true;
    target.classList.remove('health-enter','health-day-enter');if(m.overview?.connected&&!m.loading&&!m.supplementLoading&&!m.trendLoading&&!m.calendarLoading&&!m.settingsLoading&&motionKey!==key){if(!reduced){target.classList.add('health-enter');if(displayDay!==null&&displayDay!==m.day)target.classList.add('health-day-enter');motionFrame=G.animateNumbers(target,{onFinish:()=>{motionKey=key;}});}else motionKey=key;displayDay=m.day;}
  }
  target.addEventListener('keydown',event=>{if(event.key==='Escape'&&calendarOpen){event.preventDefault();event.stopPropagation();calendarOpen=false;render();target.querySelector('[aria-label="选择健康日期"]')?.focus();}});
  const motionChanged=()=>{if(G.reducedMotion()||globalThis.WeftReplyMotion?.paused){motionFrame?.();for(const n of target.querySelectorAll('[data-count-to]'))n.textContent=H.value(Number(n.dataset.countTo),n.dataset.countMetric);target.classList.remove('health-enter','health-day-enter');}};
  globalThis.addEventListener('weft-reply-motion-change',motionChanged);
  return {render,focus(){title.focus();},reset(){motionFrame?.();contentSignature='';content.replaceChildren();motionKey=displayDay=null;calendarOpen=expanded=basisOpen=moreWorkouts=false;selectedPoint=null;lastView=null;methodOpen.clear();analysisBasis.clear();},destroy(){motionFrame?.();globalThis.removeEventListener('weft-reply-motion-change',motionChanged);target.replaceChildren();}};
}};

/* The health settings section shares controls and actions across both renderers. */
globalThis.WeftHealthView.settings=(core,target,{toast}={})=>{
  const identity=core.state.identityGeneration,controls=WeftSettingsControls;
  const current=()=>target.isConnected&&identity===core.state.identityGeneration;
  const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
  const form=el('div','','personalization-form health-settings'),notice=el('p','正在读取健康设置…','muted');notice.setAttribute('role','status');target.replaceChildren(form);form.append(notice);
  const inputs=new Map();let busy=false;
  function paint(){if(!current())return;form.replaceChildren(notice);inputs.clear();
    const settings=core.health.settings;if(!settings){notice.textContent='暂时读不到健康设置，请连接电脑后重试。';const retry=el('button','重试','button secondary');retry.type='button';retry.onclick=()=>void load();form.append(retry);return;}
    notice.textContent='';for(const [key,label,description]of [
      ['modelInsightsEnabled','今日解读用模型写','默认开启。把每天的汇总数字交给你设置的模型，写顶部的今日解读；关闭后用统计解读。'],
      ['itemAnalysisEnabled','各项的 AI 分析','默认关闭。打开后，只在你展开某一项时分析其每日汇总，不发明细；不影响今日解读。']]){
      if(key==='itemAnalysisEnabled'&&!Object.hasOwn(settings,key))continue;
      const input=el('input');input.id=`health-setting-${key}`;input.type='checkbox';input.checked=settings[key]===true;input.disabled=busy;input.setAttribute('aria-label',label);controls.toggle(input);inputs.set(key,input);form.append(controls.row(label,description,input));
      input.onchange=async()=>{if(busy)return;busy=true;for(const n of inputs.values())n.disabled=true;const before=settings[key];try{await core.saveHealthViewSettings({[key]:input.checked});if(current())toast?.('健康设置已保存');}catch(error){if(current()){input.checked=before;toast?.(core.failureMessage(error));}}finally{busy=false;paint();inputs.get(key)?.focus();}};
    }
    form.append(el('p','按公开方法做的估计，不是医学结论','muted health-settings-notice'));
  }
  async function load(){await core.readHealthSettings();paint();}void load();return {refresh:load};
};
