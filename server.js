import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import { randomBytes, randomUUID } from 'node:crypto';

const app=express();const server=http.createServer(app);const io=new Server(server,{pingTimeout:20000,cors:{origin:false}});
app.use(express.static('public'));
const rooms=new Map();
const ROLES={wolf:'Ma Sói',villager:'Dân làng',seer:'Tiên tri',witch:'Phù thủy',guard:'Bảo vệ',hunter:'Thợ săn',cupid:'Cupid'};
const SPECIAL=['seer','witch','guard','hunter','cupid'];
const NIGHT_ORDER=['cupid','guard','seer','wolf','witch'];
const DEFAULT={discussion:100,vote:45,night:35};
const code=()=>randomBytes(3).toString('hex').toUpperCase();
const clean=(s,n=30)=>String(s??'').trim().slice(0,n).replace(/[<>]/g,'');
const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a};
const living=r=>r.players.filter(p=>p.alive);
const find=(r,id)=>r.players.find(p=>p.id===id);
const isWolf=p=>p?.role==='wolf';
const byCount=(r)=>{let n=r.players.length;let wolves=n>=9?2:1;let specials=r.settings.specials.filter(x=>SPECIAL.includes(x));let pool=['wolf',...Array(wolves-1).fill('wolf'),...specials];if(pool.length>n)pool=pool.slice(0,n);return shuffle([...pool,...Array(n-pool.length).fill('villager')]);};
function system(r,message){r.messages.push({id:randomUUID(),type:'system',message,time:Date.now()});r.messages=r.messages.slice(-100)}
function roomPublic(r){return {code:r.code,name:r.name,phase:r.phase,day:r.day,deadline:r.deadline,host:r.host,settings:r.settings,players:r.players.map(p=>({id:p.id,name:p.name,alive:p.alive,online:p.online,ready:p.ready})),messages:r.messages.filter(m=>m.type==='system'||m.scope==='all'),votes:r.phase==='vote'?Object.keys(r.votes).length:0};}
function view(r,p){const v=roomPublic(r);v.self={id:p.id,role:p.role,alive:p.alive,lover:p.lover,witchHeal:p.witchHeal,witchPoison:p.witchPoison};v.messages=r.messages.filter(m=>m.type==='system'||m.scope==='all'||(m.scope==='wolf'&&p.role==='wolf')).slice(-70);v.action=null;v.privateInfo=p.privateInfo??null;v.voteTarget=r.votes[p.id]??null;
 if(r.phase==='night'&&p.alive){if(p.role===r.nightRole)v.action={kind:r.nightRole,targets:targets(r,p),submitted:!!r.actions[p.id],wolfVotes:r.nightRole==='wolf'?Object.values(r.actions).filter(x=>x.kind==='wolf').length:undefined};else v.action={kind:'wait',targets:[]};}
 if(r.phase==='hunter'&&r.hunterId===p.id)v.action={kind:'hunter',targets:living(r).filter(x=>x.id!==p.id).map(x=>({id:x.id,name:x.name}))};
 if(r.phase==='vote'&&p.alive)v.action={kind:'vote',targets:living(r).filter(x=>x.id!==p.id).map(x=>({id:x.id,name:x.name})),submitted:!!r.votes[p.id]};
 if(r.phase==='ended')v.reveal=r.players.map(x=>({id:x.id,name:x.name,role:x.role}));return v;}
function emit(r){io.to(r.code).emit('room:public',roomPublic(r));for(const p of r.players){if(p.socketId)io.to(p.socketId).emit('room:state',view(r,p));}}
function targets(r,p){const alive=living(r);let xs=[];switch(p.role){case 'wolf':xs=alive.filter(x=>x.role!=='wolf');break;case 'seer':xs=alive.filter(x=>x.id!==p.id);break;case 'guard':xs=alive.filter(x=>x.id!==r.lastGuard);break;case 'witch':xs=alive.filter(x=>x.id!==p.id);break;case 'cupid':xs=alive.filter(x=>x.id!==p.id);break;default:xs=[];}return xs.map(x=>({id:x.id,name:x.name}));}
function clear(r){if(r.timer)clearTimeout(r.timer);r.timer=null;}
function schedule(r,secs,fn){clear(r);r.deadline=Date.now()+secs*1000;r.timer=setTimeout(()=>{r.timer=null;fn(r)},secs*1000);emit(r)}
function finish(r,side){clear(r);r.phase='ended';r.winner=side;r.deadline=null;system(r,`Ván kết thúc! ${side==='village'?'Phe Làng':side==='wolf'?'Phe Sói':'Đôi tình nhân'} chiến thắng.`);emit(r)}
function winner(r){let a=living(r),w=a.filter(isWolf),v=a.filter(p=>!isWolf(p));if(a.length===2&&a.every(p=>p.lover===a.find(x=>x.id!==p.id)?.id))return 'lovers';if(w.length===0)return 'village';if(w.length>=v.length)return 'wolf';return null}
function check(r){const w=winner(r);if(w){finish(r,w);return true}return false}
function eliminate(r,ids,reason){let out=[];const kill=(id)=>{let p=find(r,id);if(!p||!p.alive)return;p.alive=false;out.push(p);if(p.lover)kill(p.lover)};for(let id of ids)kill(id);if(out.length)system(r,`${reason}: ${out.map(p=>p.name).join(', ')}.`);return out}
function afterDeaths(r,out){const hunter=out.find(p=>p.role==='hunter');if(hunter&&living(r).length){r.phase='hunter';r.hunterId=hunter.id;system(r,'Thợ săn có quyền chọn một người trước khi rời làng.');schedule(r,20,()=>{r.hunterId=null;nextAfterDeaths(r)});return}nextAfterDeaths(r)}
function nextAfterDeaths(r){r.hunterId=null;if(check(r))return;startDiscussion(r)}
function startDiscussion(r){r.phase='discussion';r.nightRole=null;r.actions={};system(r,`Ngày ${r.day}: Bắt đầu thảo luận.`);schedule(r,r.settings.discussion,()=>startVote(r))}
function startVote(r){r.phase='vote';r.votes={};system(r,'Đã đến giờ bỏ phiếu.');schedule(r,r.settings.vote,resolveVote)}
function resolveVote(r){let counts={};for(let id of Object.values(r.votes)){if(find(r,id)?.alive)counts[id]=(counts[id]||0)+1}let max=Math.max(0,...Object.values(counts));let top=Object.keys(counts).filter(k=>counts[k]===max);let target=max>0&&top.length===1?top[0]:null;system(r,target?`Kết quả: ${find(r,target).name} nhận ${max} phiếu.`:'Không ai bị loại do hòa phiếu hoặc không có phiếu hợp lệ.');let out=target?eliminate(r,[target],'Bỏ phiếu loại'):[];if(out.length)afterDeathsVote(r,out);else nextNight(r)}
function afterDeathsVote(r,out){const hunter=out.find(p=>p.role==='hunter');if(hunter&&living(r).length){r.phase='hunter';r.hunterId=hunter.id;r.afterHunter='night';schedule(r,20,()=>{r.hunterId=null;if(!check(r))nextNight(r)});return}if(!check(r))nextNight(r)}
function nextNight(r){r.day++;r.phase='night';r.actions={};r.nightRole=null;r.nightIndex=-1;r.nightData={guard:null,wolf:null,poison:null,heal:false};system(r,`Đêm ${r.day} buông xuống.`);advanceNight(r)}
function advanceNight(r){r.actions={};r.nightIndex++;if(r.nightIndex>=NIGHT_ORDER.length){resolveNight(r);return}let role=NIGHT_ORDER[r.nightIndex];if(role==='cupid'&&r.day>1){advanceNight(r);return}if(!living(r).some(p=>p.role===role)){advanceNight(r);return}r.nightRole=role;system(r,`Đêm ${r.day}: Một vai trò đang thực hiện nhiệm vụ.`);schedule(r,r.settings.night,resolveNightRole)}
function resolveNightRole(r){let role=r.nightRole;let acts=Object.values(r.actions).filter(a=>a.kind===role);if(role==='cupid'){let a=acts[0];if(a?.targets?.length===2){let [x,y]=a.targets.map(id=>find(r,id));if(x&&y&&x.id!==y.id){x.lover=y.id;y.lover=x.id;x.privateInfo=`Bạn được Cupid ghép đôi với ${y.name}.`;y.privateInfo=`Bạn được Cupid ghép đôi với ${x.name}.`;}}}
 if(role==='guard'){let a=acts[0];r.nightData.guard=a?.target||null;if(a?.target)r.lastGuard=a.target;}
 if(role==='seer'){for(let a of acts){let p=find(r,a.player),t=find(r,a.target);if(p&&t)p.privateInfo=`Tiên tri đã soi ${t.name}: ${isWolf(t)?'Phe Sói':'Không phải Ma Sói'}.`;}}
 if(role==='wolf'){let count={};for(let a of acts){if(find(r,a.target)?.alive)count[a.target]=(count[a.target]||0)+1}let max=Math.max(0,...Object.values(count));let top=Object.keys(count).filter(id=>count[id]===max);r.nightData.wolf=max&&top.length?top[Math.floor(Math.random()*top.length)]:null;}
 if(role==='witch'){for(let a of acts){let p=find(r,a.player);if(!p)continue;if(a.choice==='heal'&&p.witchHeal){r.nightData.heal=true;p.witchHeal=false}if(a.choice==='poison'&&p.witchPoison&&find(r,a.target)?.alive){r.nightData.poison=a.target;p.witchPoison=false}}}
 advanceNight(r)}
function resolveNight(r){let d=r.nightData,dead=[];if(d.wolf&&!(d.heal||d.guard===d.wolf))dead.push(d.wolf);if(d.poison)dead.push(d.poison);let out=eliminate(r,dead,'Đêm qua đã mất');if(!out.length)system(r,'Đêm qua là một đêm bình yên.');afterDeaths(r,out)}
function startGame(r){let roles=byCount(r);r.players.forEach((p,i)=>{p.role=roles[i];p.alive=true;p.ready=false;p.lover=null;p.witchHeal=true;p.witchPoison=true;p.privateInfo=null});r.day=0;r.messages=[];r.lastGuard=null;r.winner=null;system(r,'Trò chơi bắt đầu. Vai trò đã được phân phát bí mật.');nextNight(r)}
function ack(cb,obj){if(typeof cb==='function')cb(obj)}
function error(cb,msg){ack(cb,{ok:false,error:msg})}
function authenticate(socket,cb){const r=rooms.get(socket.data.code);const p=r&&find(r,socket.data.playerId);if(!r||!p){error(cb,'Bạn chưa ở trong phòng.');return null}return {r,p}}
function cleanup(r){if(!r.players.length){clear(r);rooms.delete(r.code)}else{if(!find(r,r.host))r.host=r.players[0].id;emit(r)}}
io.on('connection',socket=>{
 socket.on('room:list',cb=>ack(cb,{ok:true,rooms:[...rooms.values()].filter(r=>r.phase==='lobby'&&!r.private).map(r=>({code:r.code,name:r.name,count:r.players.length,max:r.settings.max}))}));
 socket.on('room:create',(data={},cb)=>{let name=clean(data.name,24)||'Ngôi Làng Bí Ẩn';let playerName=clean(data.playerName,18)||'Khách';let id=randomUUID();let r={code:code(),name,private:!!data.private,host:id,phase:'lobby',day:0,deadline:null,players:[],messages:[],timer:null,settings:{max:10,discussion:Math.min(240,Math.max(30,Number(data.discussion)||DEFAULT.discussion)),vote:DEFAULT.vote,night:DEFAULT.night,specials:SPECIAL},votes:{},actions:{}};while(rooms.has(r.code))r.code=code();let p={id,name:playerName,socketId:socket.id,online:true,ready:false,alive:true,role:null};r.players.push(p);rooms.set(r.code,r);socket.join(r.code);socket.data={code:r.code,playerId:id};ack(cb,{ok:true,code:r.code,playerId:id});emit(r)});
 socket.on('room:join',(data={},cb)=>{let r=rooms.get(clean(data.code,8).toUpperCase());if(!r)return error(cb,'Không tìm thấy phòng.');if(r.phase!=='lobby')return error(cb,'Ván đã bắt đầu.');if(r.players.length>=r.settings.max)return error(cb,'Phòng đã đủ người.');let name=clean(data.playerName,18)||'Khách',id=randomUUID(),p={id,name,socketId:socket.id,online:true,ready:false,alive:true,role:null};r.players.push(p);socket.join(r.code);socket.data={code:r.code,playerId:id};system(r,`${name} đã vào phòng.`);ack(cb,{ok:true,code:r.code,playerId:id});emit(r)});
 socket.on('room:resume',(data={},cb)=>{let r=rooms.get(clean(data.code,8).toUpperCase()),p=r&&find(r,data.playerId);if(!p)return error(cb,'Phiên chơi không còn tồn tại.');p.socketId=socket.id;p.online=true;socket.join(r.code);socket.data={code:r.code,playerId:p.id};ack(cb,{ok:true});emit(r)});
 socket.on('room:ready',(value,cb)=>{let x=authenticate(socket,cb);if(!x)return;if(x.r.phase!=='lobby')return error(cb,'Ván đã bắt đầu.');x.p.ready=!!value;ack(cb,{ok:true});emit(x.r)});
 socket.on('room:start',(_,cb)=>{let x=authenticate(socket,cb);if(!x)return;let {r,p}=x;if(r.host!==p.id)return error(cb,'Chỉ chủ phòng được bắt đầu.');if(r.phase!=='lobby')return error(cb,'Ván đã bắt đầu.');if(r.players.length<5)return error(cb,'Cần tối thiểu 5 người chơi.');if(r.players.some(p=>!p.ready&&p.id!==r.host))return error(cb,'Có người chưa sẵn sàng.');startGame(r);ack(cb,{ok:true})});
 socket.on('room:action',(data={},cb)=>{let x=authenticate(socket,cb);if(!x)return;let {r,p}=x;if(!p.alive&&r.phase!=='hunter')return error(cb,'Bạn đã bị loại.');if(r.phase==='vote'){if(!p.alive||r.votes[p.id])return error(cb,'Bạn đã bỏ phiếu.');if(!living(r).some(q=>q.id===data.target&&q.id!==p.id))return error(cb,'Mục tiêu không hợp lệ.');r.votes[p.id]=data.target;ack(cb,{ok:true});if(Object.keys(r.votes).length>=living(r).length){clear(r);resolveVote(r)}else emit(r);return}
 if(r.phase==='hunter'){if(r.hunterId!==p.id)return error(cb,'Không phải lượt của bạn.');let t=find(r,data.target);if(!t?.alive)return error(cb,'Mục tiêu không hợp lệ.');clear(r);r.hunterId=null;let out=eliminate(r,[t.id],'Thợ săn đã chọn');if(out.some(x=>x.role==='hunter'))system(r,'Hiệu ứng Thợ săn nối tiếp không được kích hoạt.');if(!check(r)){if(r.afterHunter==='night'){r.afterHunter=null;nextNight(r)}else startDiscussion(r)}ack(cb,{ok:true});return}
 if(r.phase!=='night'||p.role!==r.nightRole||r.actions[p.id])return error(cb,'Chưa đến lượt hoặc bạn đã hành động.');let kind=p.role;let allowed=targets(r,p).map(t=>t.id);let act={player:p.id,kind};if(kind==='cupid'){if(!Array.isArray(data.targets)||data.targets.length!==2||new Set(data.targets).size!==2||!data.targets.every(id=>allowed.includes(id)))return error(cb,'Chọn hai người khác nhau.');act.targets=data.targets}
 else if(kind==='witch'){if(!['heal','poison','skip'].includes(data.choice))return error(cb,'Lựa chọn không hợp lệ.');if(data.choice==='heal'&&!p.witchHeal||data.choice==='poison'&&!p.witchPoison)return error(cb,'Đã hết kỹ năng.');if(data.choice==='poison'&&!allowed.includes(data.target))return error(cb,'Mục tiêu không hợp lệ.');act.choice=data.choice;act.target=data.target}
 else{if(!allowed.includes(data.target))return error(cb,'Mục tiêu không hợp lệ.');act.target=data.target}
 r.actions[p.id]=act;ack(cb,{ok:true});let actors=living(r).filter(q=>q.role===kind);if(actors.every(q=>r.actions[q.id])){clear(r);resolveNightRole(r)}else emit(r)});
 socket.on('room:chat',(message,cb)=>{let x=authenticate(socket,cb);if(!x)return;let {r,p}=x;let msg=clean(message,350);if(!msg)return error(cb,'Tin nhắn trống.');if(!p.alive||!['lobby','discussion'].includes(r.phase))return error(cb,'Không thể chat lúc này.');let now=Date.now();if(p.lastMessage&&now-p.lastMessage<800)return error(cb,'Gửi tin nhắn quá nhanh.');p.lastMessage=now;r.messages.push({id:randomUUID(),type:'chat',scope:'all',name:p.name,playerId:p.id,message:msg,time:now});r.messages=r.messages.slice(-100);ack(cb,{ok:true});emit(r)});
 socket.on('room:restart',(_,cb)=>{let x=authenticate(socket,cb);if(!x)return;let {r,p}=x;if(p.id!==r.host||r.phase!=='ended')return error(cb,'Không thể chơi lại lúc này.');clear(r);r.phase='lobby';r.day=0;r.deadline=null;r.messages=[];r.players.forEach(p=>{p.ready=false;p.alive=true;p.role=null;p.lover=null;p.privateInfo=null});ack(cb,{ok:true});emit(r)});
 socket.on('room:leave',(_,cb)=>{let x=authenticate(socket,cb);if(!x)return;let {r,p}=x;if(r.phase!=='lobby'&&r.phase!=='ended')return error(cb,'Không thể rời phòng giữa ván; hãy đóng trang và kết nối lại sau.');r.players=r.players.filter(q=>q.id!==p.id);socket.leave(r.code);socket.data={};ack(cb,{ok:true});cleanup(r)});
 socket.on('disconnect',()=>{let r=rooms.get(socket.data.code),p=r&&find(r,socket.data.playerId);if(p&&p.socketId===socket.id){p.online=false;emit(r)}});
});
app.get('/health',(_,res)=>res.json({ok:true,rooms:rooms.size}));
const PORT=Number(process.env.PORT)||3000;server.listen(PORT,()=>console.log(`Ma Sói: http://localhost:${PORT}`));
