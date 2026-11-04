import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const html=read("index.html"),app=read("assets/app.js"),css=read("assets/styles.css");

function mount(search="",opts={}) {
 const classes=new Set(),styles=new Map(),calls=[],sessionCalls=[],chatCalls=[],listeners=[];
 const elements=new Map(),windowListeners=new Map(),viewportListeners=new Map();
 function node(id="") {
  return {
   id, style:{}, children:[], textContent:"", value:"", scrollHeight:48, scrollTop:0,
   disabled:false, hidden:true,
   addEventListener(name,fn) {this.handlers??={};this.handlers[name]=fn;},
   append(...items){this.children.push(...items);},
   replaceChildren(){this.children=[];},
   remove(){this.removed=true;},
   focus(){this.focused=true;},
   set className(v){this._className=v;},
   get className(){return this._className||"";},
   get scrollHeightValue(){return this.scrollHeight;},
  };
 }
 const el=id=>{if(!elements.has(id))elements.set(id,node(id));return elements.get(id);};
 const root={
  classList:{add(name){classes.add(name)}},
  style:{setProperty(name,value){styles.set(name,value);}}
 };
 const document={
  documentElement:root,
  getElementById:el,
  createElement:()=>node()
 };
 const sessionResponse=async()=>({
  ok:true,json:async()=>({verified:true,role:"stranger",firstName:""})
 });
 const window={
  location:{search},
  SANKO_CONFIG:{apiUrl:"https://sanko-chat-api.boysinger2008.workers.dev/api/chat"},
  innerHeight:775,
  matchMedia:(query)=>({matches:query==="(pointer: fine)" && opts.finePointer!==false}),
  visualViewport:{height:680,addEventListener(n,fn){viewportListeners.set(n,fn)}},
  addEventListener(n,fn){windowListeners.set(n,fn)},
  confirm(){return true;},
  vkBridge:{
   subscribe(fn){listeners.push(fn);},
   send(method){
    calls.push(method);
    if(method==="VKWebAppGetConfig")return Promise.resolve({insets:{top:20,bottom:25,left:0,right:0}});
    if(method==="VKWebAppGetUserInfo")return Promise.resolve({id:42,first_name:"Иван"});
    return Promise.resolve({});
   }
  }
 };
 const storage=new Map();
 const localStorage={
  getItem:key=>storage.get(key)??null,
  setItem:(key,value)=>storage.set(key,String(value)),
  removeItem:key=>storage.delete(key)
 };
 const fetch=async(url,options)=>{
  if(String(url).endsWith("/api/chat")) {
   chatCalls.push({url,options});
   return {ok:true,status:200,json:async()=>({
    reply:"Шо нового? Да вот делами занимаемся.",
    conversationId:"123e4567-e89b-42d3-a456-426614174000",
    knowledge:{focusDate:""}
   })};
  }
  sessionCalls.push({url,options});
  return sessionResponse();
 };
 runInNewContext(app,{window,document,localStorage,fetch,URL,URLSearchParams,
  crypto:webcrypto,Uint32Array,Uint8Array,AbortController,setTimeout,clearTimeout,
  console},{filename:"assets/app.js",timeout:1000});
 return {classes,styles,calls,sessionCalls,chatCalls,elements,el,window,viewportListeners,listeners};
}
test("VK Mini App URL keeps the same HTTPS GitHub Pages application",()=>{
 assert.match(html,/https:\/\/unpkg\.com\/@vkontakte\/vk-bridge@2\.15\.12\/dist\/browser\.min\.js/);
 assert.match(html,/<meta name="referrer" content="no-referrer">/);
 assert.match(html,/viewport-fit=cover/);
 assert.match(html,/\.\/assets\/app\.js/);
 assert.match(html,/\.\/assets\/styles\.css/);
 assert.match(html,/enterkeyhint="send"/);
 assert(!html.includes("VK_APP_SECRET"));
});
test("ordinary browser stays standalone and never calls VK Bridge",()=>{
 const x=mount("");
 assert(!x.classes.has("vk-embedded"));
 assert(x.el("messages").children.length>0,"Chat greeting visible immediately");
 assert.equal(x.calls.length,0);
 assert.equal(x.sessionCalls.length,0);
});
test("VK app renders immediately before server session and initializes Bridge",async()=>{
 const x=mount("?vk_app_id=123456&vk_user_id=42&vk_platform=android&vk_ts=1762256400&sign=fake");
 assert(x.classes.has("vk-embedded"));
 assert(x.el("messages").children.length>0,"No empty chat while VK API loads");
 assert.equal(x.styles.get("--vk-visible-height"),"680px");
 assert(x.calls.includes("VKWebAppInit"));
 await new Promise(r=>setTimeout(r,40));
 assert(x.calls.includes("VKWebAppGetConfig"));
 assert(x.calls.includes("VKWebAppGetUserInfo"));
 assert(x.sessionCalls.some(v=>v.url.endsWith("/api/session")));
 const session=x.sessionCalls.find(v=>v.url.endsWith("/api/session"));
 const body=JSON.parse(session.options.body);
 assert.equal(body.vkFirstNameUserId,42);
 assert.equal(body.vkFirstName,"Иван");
 assert.equal(body.vkLaunch,x.window.location.search);
 assert.equal(x.styles.get("--vk-inset-bottom"),"25px");
 x.listeners[0]({detail:{type:"VKWebAppUpdateConfig",
  data:{insets:{top:37,bottom:53,left:9,right:10}}}});
 assert.equal(x.styles.get("--vk-inset-top"),"37px");
 assert.equal(x.styles.get("--vk-inset-bottom"),"53px");
 x.window.visualViewport.height=425;
 x.viewportListeners.get("resize")();
 assert.equal(x.styles.get("--vk-visible-height"),"425px");
});
test("unsuitable VK insets never become unsafe dimensions",async()=>{
 const x=mount("?vk_app_id=123456&vk_user_id=42&sign=unverified");
 x.listeners[0]({detail:{type:"VKWebAppUpdateConfig",
  data:{insets:{top:-20,bottom:999,left:"bad",right:12}}}});
 assert.equal(x.styles.get("--vk-inset-top"),undefined);
 assert.equal(x.styles.get("--vk-inset-bottom"),undefined);
 assert.equal(x.styles.get("--vk-inset-right"),"12px");
 await new Promise(r=>setTimeout(r,25));
});
test("VK desktop shows Sanko's panel, while mobile and short VK frames remain chat-first",()=>{
 for(const token of [
  "html.vk-embedded","--vk-visible-height","--vk-inset-bottom",
  ".vk-embedded .side{display:none}",".vk-embedded .composer-wrap",
  ".vk-embedded .messages",".vk-embedded .topbar"
 ])assert(css.includes(token),token);
 // The initial VK-only selector intentionally stays one-column; a narrower
 // responsive rule restores the actual existing sidebar on desktop.
 const desktop=css.match(/@media \(min-width:800px\) and \(min-height:560px\) \{([\s\S]*?)\n\}/u);
 assert(desktop,"VK desktop breakpoint must be scoped by iframe width and height");
 assert.match(desktop[1],/\.vk-embedded \.shell\s*\{\s*display:grid/u);
 assert.match(desktop[1],/grid-template-columns:clamp\(270px,35%,345px\) minmax\(0,1fr\)/u);
 assert.match(desktop[1],/\.vk-embedded \.side\s*\{\s*display:flex/u);
 assert.match(desktop[1],/\.vk-embedded \.chat\s*\{height:100%;min-width:0;min-height:0\}/u);
 assert(css.includes("@media(max-width:700px)"),"Regular mobile layout preserved");
 assert(css.includes("safe-area-inset-bottom"),"VK must leave space for safe areas");
 assert(html.includes('class="side"') && html.includes('sanko-portrait.jpg'),
  "VK desktop must use the canon portrait and existing side panel");
});


test("VK desktop keeps the cursor in the question box after a reply",async()=>{
 const x=mount("?vk_app_id=54875852&vk_user_id=42&sign=fake",{finePointer:true});
 const firstBubble=x.el("messages").children[0].children[1].textContent;
 assert(firstBubble.includes("Здрав будь"),"a greeting was displayed");
 const input=x.el("input"),form=x.el("composer");
 input.focused=false;
 input.value="То же, шо и у тебя.";
 await form.handlers.submit({preventDefault(){}});
 assert.equal(input.disabled,false);
 assert.equal(input.focused,true,"VK desktop must refocus the textarea after submit");
 assert.equal(x.chatCalls.length,1);
 const body=JSON.parse(x.chatCalls[0].options.body);
 assert.equal(body.openingGreeting,firstBubble,
  "exact visible greeting is sent as first-turn conversational context");
 assert.deepEqual(body.history,[],"do not fake past user turns");
 input.focused=false;
 input.value="Шо ты несёшь?";
 await form.handlers.submit({preventDefault(){}});
 assert.equal(input.focused,true,"focus stays restored on every turn");
 assert.equal(x.chatCalls.length,2);
 const second=JSON.parse(x.chatCalls[1].options.body);
 assert.equal(second.openingGreeting,"","opening must not repeat on follow-up");
 assert.equal(second.history.length,2,"real first user+model turns are sent");
});
test("VK touch devices do not force an unexpected software keyboard",async()=>{
 const x=mount("?vk_app_id=54875852&vk_user_id=42&sign=fake",{finePointer:false});
 const input=x.el("input"),form=x.el("composer");
 input.focused=false;input.value="Здрав будь!";
 await form.handlers.submit({preventDefault(){}});
 assert.equal(input.focused,false,"touch screen should not reopen the keyboard");
 assert.equal(input.disabled,false);
});
test("standalone desktop continues to restore input focus",async()=>{
 const x=mount("");
 const input=x.el("input"),form=x.el("composer");
 input.focused=false;input.value="Привет!";
 await form.handlers.submit({preventDefault(){}});
 assert.equal(input.focused,true);
 assert.equal(x.chatCalls.length,1);
});

test("Sanko VK desktop sidebar uses actual treehouse image, preserving readable text",()=>{
 const photo=readFileSync(new URL("../assets/sanko-oselya-sidebar.webp",import.meta.url));
 assert.equal(photo.toString("ascii",0,4),"RIFF");
 assert.equal(photo.toString("ascii",8,12),"WEBP");
 assert(photo.byteLength>10000 && photo.byteLength<100000,"Keep image real but lightweight");
 assert(css.includes("background:url('./sanko-oselya-sidebar.webp') center center/cover no-repeat"));
 assert(!css.includes("background:url('./forest.svg')"),"Old generic forest must not remain active");
 assert.match(css,/\.side:after\{[^}]*linear-gradient\(180deg,/u);
 assert(html.includes('class="side"') && html.includes('sanko-portrait.jpg'));
 assert(css.includes("@media (min-width:800px) and (min-height:560px)"));
});
