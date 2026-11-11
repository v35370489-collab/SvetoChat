/* Nexo Chat: realtime web client. Configure SUPABASE_URL and SUPABASE_ANON_KEY below. */
const SUPABASE_URL = window.NEXO_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = window.NEXO_SUPABASE_ANON_KEY || "";
const $ = id => document.getElementById(id);
let sb=null,user=null,profile=null,rooms=[],activeRoom=null,roomMessages=[],roomSubscription=null,roomsSubscription=null,messageSubscription=null,authMode="login",filter="all",unreadOnly=false;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const time=s=>s?new Date(s).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}):"";
function setStatus(text,ok=false){$("connection").innerHTML=`<span class="dot" style="background:${ok?'#54dfa1':'#f2b45f'}"></span>${esc(text)}`}
function showAuth(show){$("authModal").classList.toggle("hidden",!show)}
function showError(id,msg){$(id).textContent=msg||""}
function configured(){return SUPABASE_URL.startsWith("https://")&&SUPABASE_ANON_KEY.length>20}
function getRoomType(r){return r.room_type||"direct"}
function roomLabel(r){return r.name||"Личный чат"}
function avatar(r){return (r.name||"N").trim().slice(0,1).toUpperCase()}
async function init(){
 if(!configured()){setStatus("Нужна настройка");showAuth(true);$("authError").textContent="Сначала настрой Supabase: открой README.md и впиши URL и anon key в начало app.js.";return}
 sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 sb.auth.onAuthStateChange((event,session)=>{setTimeout(()=>{user=session?.user||null;if(user)afterLogin();else showAuth(true)},0)});
 const {data:{session}}=await sb.auth.getSession();user=session?.user||null;
 if(user)await afterLogin();else showAuth(true);
}
$("switchAuth").onclick=()=>{authMode=authMode==="login"?"signup":"login";$("authTitle").textContent=authMode==="login"?"Войти в аккаунт":"Создать аккаунт";$("authSubmit").textContent=authMode==="login"?"Войти":"Зарегистрироваться";$("switchAuth").textContent=authMode==="login"?"Создать аккаунт":"У меня уже есть аккаунт";$("authName").classList.toggle("hidden",authMode==="login");showError("authError","")};
$("authForm").onsubmit=async e=>{e.preventDefault();if(!sb)return;const email=$("authEmail").value.trim(),password=$("authPassword").value,name=$("authName").value.trim();$("authSubmit").disabled=true;showError("authError","");try{
 if(authMode==="signup"){const {data,error}=await sb.auth.signUp({email,password,options:{data:{display_name:name||email.split("@")[0]}}});if(error)throw error;if(!data.session){showError("authError","Проверь почту и подтверди регистрацию, затем войди.");return}}
 else {const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw error}
 }catch(err){showError("authError",err.message||"Не удалось войти")}finally{$("authSubmit").disabled=false}};
async function afterLogin(){
 if(!sb||!user)return;showAuth(false);setStatus("Подключаемся");
 try{
 const {data:p,error:pe}=await sb.from("profiles").select("*").eq("id",user.id).maybeSingle();if(pe)throw pe;
 profile=p;if(!profile){const display=user.user_metadata?.display_name||user.email?.split("@")[0]||"Nexo user";const {data,error}=await sb.from("profiles").upsert({id:user.id,display_name:display}).select().single();if(error)throw error;profile=data}
 await loadRooms();subscribeRooms();setStatus("Онлайн",true);
 }catch(e){setStatus("Ошибка настройки");$("messages").innerHTML=`<div class="empty">Не удалось загрузить чаты.<br><br>${esc(e.message)}<br><br>Проверь SQL из README и настройки Supabase.</div>`}
}
async function loadRooms(){
 const {data,error}=await sb.from("room_members").select("room_id,rooms(id,name,description,room_type,created_at,created_by)").eq("user_id",user.id).order("created_at",{ascending:false});
 if(error)throw error;rooms=(data||[]).map(x=>({...x.rooms,membership:x})).filter(Boolean);
 renderRooms();if(activeRoom&&!rooms.some(r=>r.id===activeRoom.id))activeRoom=null;
 if(!activeRoom&&rooms.length)await openRoom(rooms[0].id);
 if(!rooms.length){$("chatHeader").innerHTML='<div class="avatar">N</div><div><b>Добро пожаловать в Nexo</b><div class="muted">Создай чат, группу или канал</div></div>';$("messages").innerHTML='<div class="empty">Пока здесь пусто.<br>Нажми «Создать», чтобы начать.</div>'}
}
function renderRooms(){
 const q=$("searchChats").value.toLowerCase();const list=rooms.filter(r=>(filter==="all"||getRoomType(r)===filter)&&(!unreadOnly)&&roomLabel(r).toLowerCase().includes(q));
 $("chatRows").innerHTML=list.length?list.map(r=>`<button class="row ${activeRoom?.id===r.id?"active":""}" data-room="${r.id}"><div class="avatar">${esc(avatar(r))}</div><div style="min-width:0;flex:1"><div style="font-size:13px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(roomLabel(r))}</div><div class="muted" style="margin-top:5px">${getRoomType(r)==="channel"?"Канал":getRoomType(r)==="group"?"Группа":"Личный чат"}</div></div></button>`).join(""):'<div class="empty">Чатов пока нет.<br>Создай новый чат или группу.</div>';
 document.querySelectorAll("[data-room]").forEach(b=>b.onclick=()=>openRoom(b.dataset.room));
}
async function openRoom(id){
 const r=rooms.find(x=>x.id===id);if(!r)return;activeRoom=r;renderRooms();
 $("chatPanel").classList.remove("mobile-hide");$("chatList").classList.remove("mobile-show");
 $("chatHeader").innerHTML=`<div class="avatar">${esc(avatar(r))}</div><div style="flex:1;min-width:0"><b>${esc(roomLabel(r))}</b><div class="muted">${getRoomType(r)==="channel"?"Канал":getRoomType(r)==="group"?"Групповой чат":"Личная переписка"}</div></div><button class="iconbtn" id="roomInfo">ⓘ</button>`;
 $("roomInfo").onclick=()=>alert(`${r.name}\n${r.description||"Без описания"}\nТип: ${getRoomType(r)}\nID: ${r.id}`);
 $("messageInput").placeholder=getRoomType(r)==="channel"?"Написать публикацию...":"Напиши сообщение...";
 if(messageSubscription){sb.removeChannel(messageSubscription);messageSubscription=null}
 const {data,error}=await sb.from("messages").select("id,room_id,sender_id,content,created_at,profiles(display_name)").eq("room_id",id).order("created_at",{ascending:true}).limit(500);
 if(error){$("messages").innerHTML=`<div class="empty">${esc(error.message)}</div>`;return}
 roomMessages=data||[];renderMessages();
 messageSubscription=sb.channel("messages-"+id).on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:`room_id=eq.${id}`},async payload=>{
  if(payload.new.sender_id===user.id)return;
  const {data:p}=await sb.from("profiles").select("display_name").eq("id",payload.new.sender_id).maybeSingle();
  roomMessages.push({...payload.new,profiles:p});renderMessages();
 }).subscribe();
}
function renderMessages(){
 $("messages").innerHTML='<div class="muted" style="text-align:center;font-size:11px;padding:4px">Начало переписки</div>'+roomMessages.map(m=>{const mine=m.sender_id===user?.id;return `<div style="display:flex;flex-direction:column;align-items:${mine?"flex-end":"flex-start"}">${!mine?`<div class="muted" style="font-size:11px;margin:0 0 5px 4px">${esc(m.profiles?.display_name||"Участник")}</div>`:""}<div class="bubble ${mine?"mine":"theirs"}">${esc(m.content)}<div style="text-align:right;font-size:10px;opacity:.65;margin-top:5px">${time(m.created_at)}</div></div></div>`}).join("");
 $("messages").scrollTop=$("messages").scrollHeight;
}
async function sendMessage(){
 const content=$("messageInput").value.trim();if(!content||!activeRoom||!user)return;
 $("sendButton").disabled=true;try{const {data,error}=await sb.from("messages").insert({room_id:activeRoom.id,sender_id:user.id,content}).select("id,room_id,sender_id,content,created_at").single();if(error)throw error;roomMessages.push({...data,profiles:profile});$("messageInput").value="";renderMessages()}catch(e){alert("Не удалось отправить: "+e.message)}finally{$("sendButton").disabled=false}
}
$("sendButton").onclick=sendMessage;$("messageInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage()}});
$("emojiButton").onclick=()=>{$("messageInput").value+=" 😊";$("messageInput").focus()};
$("searchChats").oninput=renderRooms;
document.querySelectorAll("[data-filter]").forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("active",x===b));renderRooms();if(innerWidth<681){$("chatList").classList.add("mobile-show");$("chatPanel").classList.add("mobile-hide")}});
$("allButton").onclick=()=>{unreadOnly=false;renderRooms()};$("unreadButton").onclick=()=>{unreadOnly=true;renderRooms()};
let createType="group";
function openCreate(type){createType=type;$("modalTitle").textContent=type==="group"?"Новая группа":type==="channel"?"Новый канал":"Новый личный чат";$("itemName").placeholder=type==="direct"?"Имя чата":"Название";$("memberArea").classList.toggle("hidden",type==="channel");$("itemName").value="";$("itemDescription").value="";$("memberEmails").value="";showError("actionError","");$("actionModal").classList.remove("hidden")}
$("createButton").onclick=$("createButton2").onclick=$("mobileCreate").onclick=()=>{const type=prompt("Что создать?\n1 — Личный чат\n2 — Группа\n3 — Канал","2");if(type==="1")openCreate("direct");else if(type==="2")openCreate("group");else if(type==="3")openCreate("channel")};
$("newGroup").onclick=$("mobileGroups").onclick=()=>openCreate("group");$("newChannel").onclick=()=>openCreate("channel");$("closeModal").onclick=()=>$("actionModal").classList.add("hidden");
$("actionForm").onsubmit=async e=>{
 e.preventDefault();if(!user)return;const name=$("itemName").value.trim(),description=$("itemDescription").value.trim();showError("actionError","");try{
 if(createType==="direct"){
  const email=$("memberEmails").value.trim();if(!email){showError("actionError","Введи email собеседника в поле участников.");return}
  const {data:found,error:fe}=await sb.from("profiles").select("id,display_name").eq("id",user.id).limit(1);if(fe)throw fe;
  const {data:profiles,error}=await sb.from("profiles").select("id,display_name").ilike("display_name",name).limit(1);if(error)throw error;
  if(!profiles?.length){showError("actionError","Пользователь не найден по имени. Для приглашения по email нужен серверный безопасный invite-flow; сначала попроси пользователя зарегистрироваться.");return}
  const {data:room,error:re}=await sb.from("rooms").insert({name,description,room_type:"direct",created_by:user.id}).select().single();if(re)throw re;
  const {error:me}=await sb.from("room_members").insert([{room_id:room.id,user_id:user.id,role:"owner"},{room_id:room.id,user_id:profiles[0].id,role:"member"}]);if(me)throw me;
 }else{
  const {data:room,error:re}=await sb.from("rooms").insert({name,description,room_type:createType,created_by:user.id}).select().single();if(re)throw re;
  const members=[{room_id:room.id,user_id:user.id,role:"owner"}];
  if(createType==="group"){
   const emails=$("memberEmails").value.split(",").map(x=>x.trim()).filter(Boolean);
   for(const email of emails){const {data:found,error}=await sb.from("profiles").select("id").eq("id",email).maybeSingle();if(error)throw error;if(found)members.push({room_id:room.id,user_id:found.id,role:"member"})}
  }
  const {error:me}=await sb.from("room_members").insert(members);if(me)throw me;
 }
 $("actionModal").classList.add("hidden");await loadRooms();
 }catch(err){showError("actionError",err.message||"Не удалось создать")}
};
$("profileButton").onclick=()=>{$("profileModal").classList.remove("hidden");$("profileName").value=profile?.display_name||user?.user_metadata?.display_name||"";$("profileEmail").textContent=user?.email||""};
$("closeProfile").onclick=()=>$("profileModal").classList.add("hidden");
$("profileForm").onsubmit=async e=>{e.preventDefault();const display_name=$("profileName").value.trim();try{const {data,error}=await sb.from("profiles").upsert({id:user.id,display_name}).select().single();if(error)throw error;profile=data;$("profileModal").classList.add("hidden")}catch(err){showError("profileError",err.message)}};
$("logoutButton").onclick=async()=>{if(sb)await sb.auth.signOut()};
$("mobileChats").onclick=()=>{$("chatList").classList.add("mobile-show");$("chatPanel").classList.add("mobile-hide")};
function subscribeRooms(){if(roomsSubscription)sb.removeChannel(roomsSubscription);roomsSubscription=sb.channel("my-room-memberships").on("postgres_changes",{event:"*",schema:"public",table:"room_members",filter:`user_id=eq.${user.id}`},()=>loadRooms()).subscribe()}
init();