import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, BarChart3, Download, LoaderCircle, MessageSquare, Square, Table2, Trash2 } from "lucide-react";
import type { Catalog } from "./catalog";
import { MODEL_ID, number, plannerPrompt, type Answer, type Plan } from "./chat/data";
import { assistantPrompt, isStatisticsQuestion, resolveReply } from "./chat/knowledge";
import "./chat/chat.css";

const Chart=lazy(()=>import("./Chart"));
type Turn={id:number;question:string;answer?:Answer;error?:string};
type Phase="idle"|"loading"|"ready"|"working"|"stopping"|"error";
const suggestions=["Who developed Dynaword?", "What sources does Danish Dynaword include?", "Plot token counts by language"];

// Render the model's basic emphasis as React text, never as HTML or generated links.
function AnswerText({text}:{text:string}) {
  return <div className="ask-answer-text">{text.split(/\n\s*\n/).map((paragraph,i)=><p key={i}>{paragraph.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part,j)=>
    /^\*\*[^*\n]+\*\*$/.test(part)?<strong key={j}>{part.slice(2,-2)}</strong>:/^`[^`\n]+`$/.test(part)?<code key={j}>{part.slice(1,-1)}</code>:part
  )}</p>)}</div>;
}

function AnswerCard({answer}: {answer:Answer}) {
  const [display,setDisplay]=useState<"chart"|"table">(answer.format==="chart"&&answer.rows.some(r=>r.value!==null)?"chart":"table");
  const known=answer.rows.filter(r=>r.value!==null);
  const chartOption={
    grid:{left:12,right:40,top:14,bottom:36,containLabel:true},
    tooltip:{trigger:"axis" as const,axisPointer:{type:"shadow" as const},valueFormatter:(n:unknown)=>typeof n==="number"?`${number(n)} ${answer.unit}`:"Not published"},
    xAxis:{type:"value" as const,name:answer.unit,nameLocation:"middle" as const,nameGap:27,axisLabel:{fontSize:10,formatter:(v:number)=>new Intl.NumberFormat("en",{notation:"compact",maximumFractionDigits:1}).format(v)},splitLine:{lineStyle:{color:"#eceef1"}}},
    yAxis:{type:"category" as const,inverse:true,data:known.map(r=>r.label),axisLabel:{width:180,overflow:"truncate" as const,fontSize:11},axisLine:{show:false},axisTick:{show:false}},
    series:[{type:"bar" as const,data:known.map(r=>r.value!),barMaxWidth:25,itemStyle:{color:"#b7192d",borderRadius:[0,3,3,0]}}],
  };
  function download() {
    const csv=[['Label',answer.unit],...answer.rows.map(r=>[r.label,r.value===null?"Not published":String(r.value)])].map(row=>row.map(s=>'"'+s.replaceAll('"','""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement('a');a.href=url;a.download="dynaword-answer.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <article className="ask-answer">
    {answer.title&&<h2>{answer.title}</h2>}<AnswerText text={answer.text}/>
    {answer.rows.length>0&&<div className="ask-result">
      <div className="ask-result-tools"><div role="group" aria-label="Answer display"><button type="button" aria-pressed={display==="chart"} disabled={!known.length} onClick={()=>setDisplay("chart")}><BarChart3 size={14}/>Chart</button><button type="button" aria-pressed={display==="table"} onClick={()=>setDisplay("table")}><Table2 size={14}/>Table</button></div><button type="button" onClick={download} aria-label="Download answer data as CSV"><Download size={14}/>CSV</button></div>
      {display==="chart"&&known.length>0?<><Suspense fallback={<p>Drawing chart…</p>}><Chart option={chartOption} height={Math.max(220,known.length*34+70)} ariaLabel={`${answer.title}. ${answer.unit}. Exact values are available in the table.`}/></Suspense>{answer.rows.filter(r=>r.value===null).map(r=><p className="ask-missing" key={r.label}>{r.label}: not published</p>)}</>:<div className="ask-table-scroll"><table><caption className="sr-only">{answer.title}</caption><thead><tr><th scope="col">Selection</th><th scope="col">{answer.unit}</th></tr></thead><tbody>{answer.rows.map(r=><tr key={r.label}><th scope="row">{r.label}</th><td>{r.value===null?<span className="ask-missing">Not published</span>:number(r.value)}</td></tr>)}</tbody></table></div>}
    </div>}
    {answer.notes.length>0&&!answer.generated&&<details className="ask-answer-notes"><summary>Data notes</summary>{answer.notes.map(note=><p key={note}>{note}</p>)}</details>}
    {answer.generated&&answer.notes.filter(note=>!note.startsWith("AI-generated explanation")).map(note=><p className="ask-answer-note" key={note}>{note}</p>)}
    {answer.sources.length>0&&<div className="ask-citations"><span>Sources</span>{answer.sources.map(source=><a key={source.label} href={source.url} target="_blank" rel="noreferrer">{source.label}<ArrowUpRight size={12}/></a>)}</div>}
  </article>;
}

export default function Ask({catalog}: {catalog:Catalog}) {
  const [phase,setPhase]=useState<Phase>("idle"),[status,setStatus]=useState(""),[progress,setProgress]=useState(0);
  const [turns,setTurns]=useState<Turn[]>([]),[draft,setDraft]=useState(""),[loadError,setLoadError]=useState("");
  const worker=useRef<Worker|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),request=useRef(0),cancelled=useRef(false);
  const previous=useRef<{question:string;plan:Plan}|undefined>(undefined),active=useRef<{id:number;question:string}|null>(null);
  const input=useRef<HTMLTextAreaElement>(null),transcript=useRef<HTMLDivElement>(null);
  const busy=phase==="loading"||phase==="working"||phase==="stopping";
  const stopWorker=()=>{worker.current?.terminate();worker.current=null;clearTimeout(timer.current);};
  useEffect(()=>()=>{worker.current?.terminate();clearTimeout(timer.current);},[]);
  useEffect(()=>{if(transcript.current)transcript.current.scrollTop=transcript.current.scrollHeight;},[turns]);

  function load() {
    stopWorker();setPhase("loading");setStatus("Loading…");setProgress(0);setLoadError("");
    const w=new Worker(new URL("./chat/model.worker.ts",import.meta.url),{type:"module"});worker.current=w;
    const files=new Map<string,{loaded:number;total:number}>();
    const fail=(message:string)=> {
      if(worker.current!==w)return;
      stopWorker();setPhase("error");setLoadError(message);
      if(active.current) {const id=active.current.id;setTurns(ts=>ts.map(t=>t.id===id?{...t,error:message}:t));active.current=null;}
    };
    w.onerror=()=>fail("The local model could not start. Try reloading it in a current Chrome or Edge. Your other Dynaword pages still work.");
    w.onmessage=({data})=> {
      if(worker.current!==w)return;
      if(data.type==="progress") {
        if(data.file&&data.total)files.set(data.file,{loaded:data.loaded||0,total:data.total});
        const totals=[...files.values()].reduce((a,b)=>({loaded:a.loaded+b.loaded,total:a.total+b.total}),{loaded:0,total:0});
        if(totals.total)setProgress(Math.min(99,100*totals.loaded/totals.total));
        setStatus(data.status==="done"?"Preparing…":"Downloading model…");
      } else if(data.type==="ready") {clearTimeout(timer.current);setProgress(100);setPhase("ready");setStatus("Ready");input.current?.focus();}
      else if(data.type==="stage"&&active.current?.id===data.id&&!cancelled.current) {setStatus(data.stage==="reading"?"Reading…":"Answering…");}
      else if(data.type==="answer"||data.type==="error") {
        clearTimeout(timer.current);
        if(data.id===undefined) {fail(data.message||"The model could not load. Check your connection and try again.");return;}
        const current=active.current;
        if(!current||current.id!==data.id)return;
        let answer:Answer|undefined,error:string|undefined;
        try {
          if(cancelled.current)throw Error("Stopped. You can ask another question.");
          if(data.type==="error")throw Error("The local model could not finish this question. Try a shorter question, or unload and reload the model.");
          const reply=resolveReply(data.output,catalog,current.question,previous.current?.plan);
          answer=reply.answer;
          if(data.truncated)answer.notes.push("The answer reached this device's response-length limit. Ask a follow-up for more detail.");
          previous.current=reply.plan?{question:current.question,plan:reply.plan}:undefined;
        } catch(e) {error=e instanceof SyntaxError?"I could not prepare that chart. Try asking for one language and a measure, or ask a project question in your own words.":e instanceof Error?e.message:String(e);}
        setTurns(ts=>ts.map(t=>t.id===current.id?{...t,answer,error}:t));active.current=null;setPhase("ready");setStatus("Ready");
      }
    };
    timer.current=setTimeout(()=>fail("Loading took too long. Check your internet connection and try again; downloaded files may already be cached."),600000);
    w.postMessage({type:"load"});
  }
  function ask() {
    const question=draft.trim();if(!question||phase!=="ready"||!worker.current||active.current)return;
    const id=++request.current;active.current={id,question};cancelled.current=false;
    setTurns(ts=>[...ts,{id,question}]);setDraft("");setPhase("working");setStatus("Reading…");
    const history=turns.filter(t=>t.answer).slice(-2).map(t=>({question:t.question,answer:[t.answer!.text,...t.answer!.notes].join("\n")}));
    const statistics=isStatisticsQuestion(question,previous.current?.plan);
    worker.current.postMessage({type:"ask",id,question,system:statistics?plannerPrompt(catalog):assistantPrompt(catalog,question,history),history:statistics?[]:history,previous:previous.current});
    timer.current=setTimeout(()=> {
      stopWorker();setTurns(ts=>ts.map(t=>t.id===id?{...t,error:"This question took too long. Reload the model and try a shorter question."}:t));active.current=null;setPhase("error");setLoadError("The model was stopped after two minutes. You can reload it from the browser cache.");
    },120000);
  }
  function stop() {cancelled.current=true;setPhase("stopping");setStatus("Stopping…");worker.current?.postMessage({type:"stop"});}
  function unload() {stopWorker();setPhase("idle");setLoadError("");setStatus("");}
  function clear() {if(busy)return;setTurns([]);previous.current=undefined;setDraft("");input.current?.focus();}

  return <main className="ask-page">
    <header className="ask-heading"><h1>Ask Dynaword</h1></header>
    <div className="ask-model-bar" aria-label="Local model">
      <div className="ask-model-info"><a href={`https://huggingface.co/${MODEL_ID}`} target="_blank" rel="noreferrer">LFM3 · 1.7B <ArrowUpRight size={12}/></a><span>Runs on your device</span></div>
      {phase==="idle"||phase==="error"?<div className="ask-model-controls"><small>1.4 GB first download</small><button className="button ask-load" onClick={load}><Download size={14}/>{phase==="error"?"Retry":"Load model"}</button></div>:<div className="ask-model-controls"><span className="ask-model-status" role="status">{busy?<LoaderCircle size={13} className="spin"/>:<span className="ask-dot"/>}{status}</span><button className="ask-quiet-button" disabled={phase==="working"||phase==="stopping"} onClick={unload}>{phase==="loading"?"Cancel":"Unload"}</button></div>}
      {phase==="loading"&&<progress max={100} value={progress} aria-label="Model download progress"/>}
      {loadError&&<p className="ask-error" role="alert">{loadError}</p>}
    </div>
    <section className="ask-conversation" aria-label="Dynaword chat">
      {turns.length>0?<><div className="ask-conversation-top"><button disabled={busy} onClick={clear}><Trash2 size={13}/>Clear chat</button></div><div ref={transcript} className="ask-transcript" role="log" aria-label="Conversation" aria-live="polite">{turns.map(t=><div key={t.id} className="ask-turn"><div className="ask-user"><p>{t.question}</p></div>{t.answer?<AnswerCard answer={t.answer}/>:t.error?<div className="ask-reply-error" role="alert"><MessageSquare size={17}/><p>{t.error}</p></div>:<div className="ask-thinking"><LoaderCircle className="spin" size={15}/>{phase==="stopping"?"Stopping…":status}</div>}</div>)}</div></>:<div className="ask-welcome"><h2>What would you like to know?</h2><div className="ask-suggestions">{suggestions.map(q=><button key={q} onClick={()=>{setDraft(q);input.current?.focus();}}>{q}</button>)}</div></div>}
      <form className="ask-composer" onSubmit={e=>{e.preventDefault();ask();}}><label className="sr-only" htmlFor="dynaword-question">Your question about Dynaword</label><textarea ref={input} id="dynaword-question" placeholder="Ask about Dynaword…" value={draft} maxLength={1200} rows={2} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();ask();}}}/>{phase==="working"||phase==="stopping"?<button type="button" className="ask-send" disabled={phase==="stopping"} onClick={stop} aria-label="Stop answering"><Square size={16}/></button>:<button type="submit" className="ask-send" disabled={phase!=="ready"||!draft.trim()} aria-label="Send question"><ArrowUp size={20}/></button>}</form>
      <p className="ask-bottom-note">AI answers can be wrong. Check the sources.</p>
    </section>
  </main>;
}
