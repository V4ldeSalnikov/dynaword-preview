import type { Catalog, Corpus } from "../catalog";

export const MODEL_ID = "LiquidAI/LFM2.5-1.2B-Instruct-ONNX";
export const MODEL_REVISION = "10f72e70abf67ac0fd7ebf15bc5854726891d864";
const views = ["size", "domains", "sources", "annotations", "coverage", "about", "help"] as const;
const fields = ["content_quality", "educational_value", "pii_presence", "content_safety", "content_integrity", "content_ratio", "content_length", "information_density", "reasoning_indicators"];
const topics = ["dynaword", "tokens", "records", "annotations", "licensing", "search"];
export type Plan = {
  view: typeof views[number]; languages: string[]; metric: "tokens" | "records" | "sources";
  domain: string; field: string; category: string; scale: "count" | "share";
  format: "chart" | "text"; limit: number; topic: string;
};
export type Answer = {
  title: string; text: string; notes: string[]; rows: {label: string; value: number | null}[];
  unit: string; format: "chart" | "text"; sources: {label: string; url: string}[];
};
export const pretty = (s: string) => s.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
const name = (d: Corpus) => d.name.replace(" Dynaword", "");
export const number = (n: number) => n.toLocaleString("en-GB", {maximumFractionDigits: 2});
export const isFollowup = (question:string) => /^\s*(and\b|what about\b|how about\b|now\b|instead\b|same\b|just\b|only\b)/i.test(question);

export function explanationTopic(question:string):string|undefined {
  const q=question.trim().toLowerCase().replace(/[?.!]$/,'');
  if(/^(what is|what's|explain|describe|tell me about) (scandinavian )?dynaword$/.test(q))return 'dynaword';
  if(/^(what (is|are)|explain|define) (a |the )?tokens?$/.test(q))return 'tokens';
  if(/^(what (is|are)|explain|define) (a |the )?(records?|documents?)$/.test(q))return 'records';
  if(/^(what (is|are)|explain|describe) (the )?(machine.generated )?annotations?$/.test(q))return 'annotations';
  return undefined;
}

export function parsePlan(output: string, catalog: Catalog, question = "", previous?: Plan): Plan {
  const explanation=explanationTopic(question);
  if(explanation)return parsePlan(JSON.stringify({view:'about',languages:[],topic:explanation}),catalog);
  const start = output.indexOf("{"), end = output.lastIndexOf("}");
  if (start < 0 || end < start) throw Error("I could not understand that request. Try naming a language and a measure, such as ‘Plot Danish tokens by domain’.");
  const raw = JSON.parse(output.slice(start, end + 1));
  const p = {...raw};
  // Preserve explicit selections instead of letting a small model omit or change them.
  const followup=isFollowup(question);
  const named=catalog.datasets.filter(d=>new RegExp(`\\b${d.id}\\b`,"i").test(question)).map(d=>d.id);
  if(named.length)p.languages=named;
  else if(/\b(all|each|across|by) (five )?(languages|corpora|collections)\b/i.test(question))p.languages=[];
  else if(p.languages===undefined&&question)p.languages=followup?previous?.languages || []:[];
  if(typeof p.measure==="string") {
    if(['tokens','records','source_count'].includes(p.measure)) {
      if(/\btokens?\b/i.test(question))p.measure='tokens';
      else if(/\brecords?\b|\bdocuments?\b/i.test(question))p.measure='records';
    }
    const requestedLimit=question.match(/\b(?:top|largest|first)\s+(\d{1,2})\b/i);
    if(requestedLimit)p.limit=Number(requestedLimit[1]);
    if(/\bby (language|corpus|collection)\b/i.test(question))p.group_by='language';
    else if(/\bdomains?\b/i.test(question))p.group_by='domain';
    else if(p.measure!=="source_count"&&/\bsources?\b/i.test(question))p.group_by='source';
    else if(p.group_by===undefined)p.group_by=followup&&previous?plannerRequest(previous).group_by:"language";
    if(/\b(percentages?|percents?|shares?)\b|%/i.test(question))p.as_percent=true;
    else if(/\b(counts?|absolute|numbers?)\b/i.test(question))p.as_percent=false;
    else if(p.as_percent===undefined)p.as_percent=followup&&previous?.scale==="share";
    if(/\b(plot|graph|chart|visuali[sz]e)\b/i.test(question))p.chart=true;
    else if(p.chart===undefined)p.chart=followup&&previous?.format==="chart";
    if(p.domain===undefined&&followup&&previous)p.domain=previous.domain;
    if(p.category===undefined&&followup&&previous)p.category=previous.category;
    if(p.limit===undefined&&followup&&previous)p.limit=previous.limit;
  }
  if (typeof p.measure === "string") {
    const measure=p.measure.toLowerCase();
    const annotation=fields.includes(measure);
    p.view=annotation?"annotations":measure==="annotation_coverage"?"coverage":measure==="explanation"?"about":measure==="unsupported"?"help":p.group_by==="domain"?"domains":p.group_by==="source"?"sources":"size";
    p.metric=annotation||measure==="annotation_coverage"?"records":measure==="source_count"?"sources":["tokens","records"].includes(measure)?measure:measure==="explanation"||measure==="unsupported"?"tokens":measure;
    if(annotation)p.field=measure;
    if(p.as_percent!==undefined&&typeof p.as_percent!=="boolean")throw Error("Please ask for counts or percentages.");
    if(p.chart!==undefined&&typeof p.chart!=="boolean")throw Error("Please ask for a chart or a text answer.");
    p.scale=p.as_percent?"share":"count";
    p.format=p.chart?"chart":"text";
    if(p.group_by&&!['language','domain','source','category'].includes(p.group_by))throw Error("I can group by language, domain, source or annotation category.");
  }
  if (Array.isArray(p.languages)) p.languages=p.languages.map((s: unknown)=>typeof s==="string"?s.toLowerCase():s);
  const validLanguages = catalog.datasets.map(d => d.id);
  if (!views.includes(p.view) || !Array.isArray(p.languages) || p.languages.some((s: unknown) => typeof s !== "string" || !validLanguages.includes(s))) throw Error("Please ask about the five Dynaword collections: Danish, Norwegian, Swedish, Icelandic or Faroese.");
  if (p.metric !== undefined && !["tokens", "records", "sources"].includes(p.metric)) throw Error("I can compare tokens, records and source counts.");
  const domains = catalog.datasets.flatMap(d => d.domains.map(g => g.name));
  if (p.domain && p.domain !== "all" && !domains.includes(p.domain)) throw Error("That domain is not in the published summaries. Try Books, News, Legal or Web.");
  if (p.field && !fields.includes(p.field)) throw Error("That annotation field is not available in these summaries.");
  if (p.scale && !["count", "share"].includes(p.scale)) throw Error("Choose counts or percentages for the chart.");
  if (p.format && !["text", "chart"].includes(p.format)) throw Error("I can answer with text, a bar chart or a table.");
  if (p.topic && !topics.includes(p.topic)) throw Error("I can explain Dynaword, tokens, records, annotations, source licences and the search index.");
  if (p.category && typeof p.category !== "string") throw Error("Please name one annotation category.");
  return {view:p.view, languages:[...new Set<string>(p.languages)], metric:p.metric || "tokens", domain:p.domain || "all", field:p.field || "content_quality", category:p.category || "all", scale:p.scale || "count", format:p.format || "text", limit:Number.isInteger(p.limit) ? Math.max(1,Math.min(15,p.limit)) : 10, topic:p.topic || "dynaword"};
}

export function answerPlan(plan: Plan, catalog: Catalog): Answer {
  const selected = catalog.datasets.filter(d => !plan.languages.length || plan.languages.includes(d.id));
  const sources = selected.map(d => ({label:`${name(d)} ${d.version}`,url:d.stats_url}));
  const answer: Answer = {title:"",text:"",notes:[],rows:[],unit:plan.metric,format:plan.format,sources};
  const releases = "These are the releases shown on this site, not live counts of the datasets.";
  if (plan.view === "help") return {...answer,title:"What would you like to compare?",text:"I can answer questions about corpus sizes, domains, sources, annotation distributions and coverage. I do not have historical releases, individual document contents, model benchmarks or training results here. Try ‘Compare token counts across languages’.",sources:[],format:"text"};
  if (plan.view === "about") {
    const facts: Record<string,[string,string]> = {
      dynaword:["What is Dynaword?","Dynaword brings together documented text collections for Danish, Norwegian, Swedish, Icelandic and Faroese. The collections record their sources and can be extended as new data becomes available. This chat uses the published summaries bundled with the website."],
      tokens:["What do token counts mean?","A token is a piece of text produced by a tokenizer; it is not necessarily a word. These summaries use the Llama 3 tokenizer. Token counts describe text volume more consistently than record counts across these collections."],
      records:["What is a record?","A record is a published dataset row. Different sources use different document and segment lengths, so a higher record count does not necessarily mean more text. Compare tokens when you want to compare text volume."],
      annotations:["What are the annotations?","The published annotation summaries use model-generated labels, including content quality, educational value and possible personal information. They are not human judgements or guarantees of quality, safety or privacy. Missing published annotations are shown as unknown, not zero."],
      licensing:["How is the data licensed?","Licences vary by source. There is no single permission here that applies to every text. Follow the dataset cards and individual source documentation before reusing data. The website code’s MIT licence does not relicense the corpus texts."],
      search:["Which Danish release does search use?",`The record explorer searches Danish ${catalog.indexed_danish.version}: ${number(catalog.indexed_danish.records)} records. This chat and the comparison page use the published comparison releases, including Danish ${catalog.datasets.find(d=>d.id==="danish")?.version}. The two snapshots have different totals.`],
    };
    const [title,text] = facts[plan.topic];
    return {...answer,title,text,format:"text",sources:selected.map(d=>({label:`${name(d)} dataset card`,url:d.url}))};
  }
  if (plan.view === "coverage") {
    if (plan.domain !== "all") throw Error("Coverage by domain is not supported in this first version. Ask for coverage by language.");
    answer.title = "Published annotation coverage";
    answer.unit = plan.scale === "share" ? "% of records" : "annotated records";
    answer.rows = selected.map(d=>({label:name(d),value:d.annotated === null ? null : plan.scale === "share" ? 100*d.annotated/d.records : d.annotated}));
    answer.notes.push("Coverage counts rows with machine-generated metadata. Not published means unknown, not zero.");
  } else if (plan.view === "size") {
    answer.title = `${pretty(plan.metric)} by language${plan.domain !== "all" ? ` · ${plan.domain}` : ""}`;
    answer.rows = selected.map(d=>({label:name(d),value:plan.domain === "all" ? plan.metric === "sources" ? d.sources.length : d[plan.metric] : d.domains.find(g=>g.name===plan.domain)?.[plan.metric] || 0}));
    if (plan.scale === "share") {
      const total = answer.rows.reduce((sum,r)=>sum+(r.value || 0),0);
      answer.rows = answer.rows.map(r=>({...r,value:total ? 100*r.value!/total : 0}));
      answer.unit = `% of selected ${plan.metric}`;
    }
  } else if (plan.view === "annotations") {
    if (plan.metric === "tokens" || plan.metric === "sources") throw Error("Annotation distributions count records. Try ‘Plot Danish content quality by record count’.");
    if (plan.domain !== "all") throw Error("This first version supports annotation distributions for whole corpora. Use Compare corpora for annotation filters by domain.");
    if (selected.length > 1 && plan.category === "all") throw Error("Which language should I show? Try ‘Plot Danish content quality’, or compare one category: ‘Compare good-quality records across languages’.");
    answer.title = pretty(plan.field)+(selected.length===1?` · ${name(selected[0])}`:"")+(plan.category !== "all" ? ` · ${pretty(plan.category)}` : "");
    answer.unit = plan.scale === "share" ? "% of all records" : "records";
    const categories = [...new Set(selected.flatMap(d=>Object.keys(d.annotation_distributions?.[plan.field] || {})))];
    if (plan.category !== "all" && !categories.includes(plan.category)) throw Error("That category is not published for the selected annotation field.");
    answer.rows = selected.flatMap(d=> {
      const values=d.annotation_distributions?.[plan.field];
      if (!values) return [{label:name(d),value:null}];
      const keys=plan.category === "all" ? Object.keys(values) : [plan.category];
      const rows=keys.map(key=>({label:selected.length===1?pretty(key):name(d),value:values[key]===undefined?null:plan.scale==="share"?100*values[key]/d.records:values[key]}));
      if (plan.category === "all") {
        const reported=Object.values(values).reduce((a,b)=>a+b,0);
        if(reported<d.records) rows.push({label:"Unreported",value:plan.scale==="share"?100*(d.records-reported)/d.records:d.records-reported});
      }
      return rows;
    });
    answer.notes.push("Labels are machine predictions. Percentages use all records in the selected corpus, including records with unreported labels.");
  } else {
    if (plan.view === "sources" && plan.metric === "sources") throw Error("Choose tokens or records to compare source sizes.");
    answer.title = `${plan.view === "domains" ? "Domains" : "Sources"} by ${plan.metric} · ${selected.map(name).join(", ")}`;
    answer.rows = selected.flatMap(d=> {
      const groups=plan.view === "domains" ? d.domains.filter(g=>plan.domain==="all" || g.name===plan.domain) : d.sources.filter(g=>plan.domain==="all" || g.domain===plan.domain);
      return groups.map(g=> {
        const value=plan.metric === "sources" ? (g as Corpus["domains"][number]).sources : g[plan.metric];
        const total=plan.metric === "sources" ? d.sources.length : d[plan.metric];
        return {label:`${selected.length>1?name(d)+" · ":""}${g.name}`,value:plan.scale==="share"?(total?100*value/total:0):value};
      });
    });
    if(plan.scale==="share") answer.unit=`% of corpus ${plan.metric}`;
    answer.notes.push("Domain names follow the publisher’s classifications; similarly named domains have not been merged.");
  }
  answer.rows.sort((a,b)=>(b.value ?? -1)-(a.value ?? -1));
  const totalRows=answer.rows.length;
  if(plan.view === "sources" || plan.view === "domains") answer.rows=answer.rows.slice(0,plan.limit);
  if(totalRows>answer.rows.length) answer.notes.push(`Showing the largest ${answer.rows.length} of ${totalRows} entries. Percentages still use the whole corpus as their denominator.`);
  const known=answer.rows.filter(r=>r.value!==null);
  answer.text=known.length ? `${known[0].label}: ${number(known[0].value!)} ${answer.unit}${known.length>1?", the largest value in this selection":""}.` : "These counts are not published for the selected release.";
  if(answer.rows.some(r=>r.value===null)) answer.text+=" Some values are not published; they have not been treated as zero.";
  if(plan.metric==="records" && !["coverage","annotations"].includes(plan.view)) answer.notes.push("Record lengths differ between sources and languages. Record counts do not measure equal amounts of text.");
  answer.notes.push(releases);
  return answer;
}

export function plannerPrompt(catalog: Catalog): string {
  const domains=[...new Set(catalog.datasets.flatMap(d=>d.domains.map(g=>g.name)))];
  return `Extract the user's request about Dynaword statistics. Return one JSON object and nothing else. Do not answer the question or invent numbers.
Required keys:
"measure": what to count. Choose exactly one of tokens, records, source_count, annotation_coverage, ${fields.join(", ")}, explanation, unsupported.
"group_by": choose language, domain, source, or category. Annotation labels use category. Comparing whole corpora uses language.
"languages": array of requested languages from danish, norwegian, swedish, icelandic, faroese. [] means all five.
"as_percent": true for percentages or shares; false for counts.
"chart": true if the user asks for a plot, graph, chart or visual; false for a text answer.
Optional keys:
"limit": number of entries to show, default 10.
"domain": requested domain, otherwise all. Valid names: ${domains.join(", ")}.
"category": requested annotation label (e.g. good or excellent), otherwise all.
"topic": for explanation only, choose dynaword, tokens, records, annotations, licensing or search.
Meaning: text volume is tokens; documents or rows are records; quality means content_quality; educational value means educational_value; how much data is annotated means annotation_coverage. Questions asking what something means use explanation. Historical growth, document contents, word frequencies, model performance and unrelated questions use unsupported.
Follow-ups retain the previous selection, changing only what was requested. Return the complete JSON request.`;
}

export function plannerRequest(plan:Plan) {
  return {measure:plan.view==="annotations"?plan.field:plan.view==="coverage"?"annotation_coverage":plan.view==="about"?"explanation":plan.view==="help"?"unsupported":plan.metric==="sources"?"source_count":plan.metric,group_by:plan.view==="domains"?"domain":plan.view==="sources"?"source":plan.view==="annotations"?"category":"language",languages:plan.languages,as_percent:plan.scale==="share",chart:plan.format==="chart",limit:plan.limit,domain:plan.domain,category:plan.category,topic:plan.topic};
}
