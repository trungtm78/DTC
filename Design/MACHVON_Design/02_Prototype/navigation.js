/* Navigation of the design prototype. No service or production data is used. */
let recentScreens=[];
try{recentScreens=JSON.parse(localStorage.getItem('public-investment-recent')||'[]').filter(id=>SCREENS.some(s=>s.id===id)).slice(0,8)}catch{}
let lastPlatformScreen={web:'HOME-01',mobile:'MOB-07'},commandPlatform='all',commandIndex=0,commandResults=[],commandReturnFocus=null;
const normalizedSearch=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase();
function toggleViewOptions(force){const panel=$('view-panel'),open=typeof force==='boolean'?force:panel.hidden;panel.hidden=!open;$('view-options').setAttribute('aria-expanded',String(open));if(open)$('state').focus();else $('view-options').focus()}
function switchPlatform(platform){if(cur.platform===platform)return;go(lastPlatformScreen[platform]||(platform==='web'?'HOME-01':'MOB-07'))}
function closeScreenSearch(restore=true){$('catalog').classList.add('hidden');$('catalog').classList.remove('command-mode');$('screen-search').setAttribute('aria-expanded','false');if(restore&&commandReturnFocus?.isConnected)commandReturnFocus.focus()}
catalog=function(){
 const overlay=$('catalog');
 if(!overlay.classList.contains('hidden')&&overlay.querySelector('.command-dialog')){closeScreenSearch();return}
 commandReturnFocus=document.activeElement;commandPlatform='all';commandIndex=0;
 $('view-panel').hidden=true;$('view-options').setAttribute('aria-expanded','false');
 overlay.classList.remove('hidden');overlay.classList.add('command-mode');$('screen-search').setAttribute('aria-expanded','true');
 overlay.innerHTML=`<section class="command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-title"><div class="command-titlebar"><strong id="command-title">Đi đến màn hình</strong><span class="command-count">${SCREENS.length} màn hình</span><button class="icon-button" onclick="closeScreenSearch()" aria-label="Đóng tìm kiếm">×</button></div><div class="command-searchbox"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg><input id="command-query" placeholder="Tên màn hình, mã hoặc nghiệp vụ…" aria-label="Tìm màn hình" autocomplete="off" oninput="updateCommandResults()"></div><div class="command-filters" role="group" aria-label="Bộ lọc màn hình"><button data-command-platform="all" aria-pressed="true" onclick="setCommandPlatform('all')">Tất cả</button><button data-command-platform="web" aria-pressed="false" onclick="setCommandPlatform('web')">Web</button><button data-command-platform="mobile" aria-pressed="false" onclick="setCommandPlatform('mobile')">Mobile</button><select id="command-module" aria-label="Phân hệ" onchange="updateCommandResults()"><option value="">Tất cả phân hệ</option>${[...new Map(SCREENS.map(s=>[s.module,s.moduleName])).entries()].map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('')}</select></div><div id="command-results" class="command-list" aria-label="Kết quả tìm màn hình"></div><div class="command-footer"><span><kbd>↑ ↓</kbd> Chọn &nbsp; <kbd>Enter</kbd> Mở &nbsp; <kbd>Esc</kbd> Đóng</span><span id="command-matches" role="status"></span></div></section>`;
 updateCommandResults();$('command-query').focus();
};
function setCommandPlatform(value){commandPlatform=value;document.querySelectorAll('[data-command-platform]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.commandPlatform===value)));updateCommandResults()}
function updateCommandResults(){
 const query=normalizedSearch($('command-query').value.trim()),module=$('command-module').value;
 commandResults=SCREENS.filter(s=>(commandPlatform==='all'||s.platform===commandPlatform)&&(!module||s.module===module)&&query.split(/\s+/).every(term=>normalizedSearch(`${s.id} ${s.title} ${s.moduleName}`).includes(term)));
 const showRecent=!query&&!module&&commandPlatform==='all';
 if(showRecent)commandResults.sort((a,b)=>{let x=recentScreens.indexOf(a.id),y=recentScreens.indexOf(b.id);return (x<0?999:x)-(y<0?999:y)});
 commandIndex=0;let lastGroup='';
 $('command-results').innerHTML=commandResults.length?commandResults.map((s,i)=>{let group=showRecent&&recentScreens.includes(s.id)?'Vừa truy cập':'Khám phá màn hình';let label=group!==lastGroup?`<div class="command-group-label">${group}</div>`:'';lastGroup=group;return `${label}<button class="command-result" data-index="${i}" data-active="${i===0}" onclick="openCommandScreen(${i})"><span class="result-mark">${esc(s.module)}</span><span class="result-copy"><strong>${esc(s.title)}</strong><small>${esc(s.id)} · ${esc(s.moduleName)}</small></span><span class="result-tail">${s.id===cur.id?'Đang xem':s.platform==='mobile'?'Mobile':'Web'}</span></button>`}).join(''):'<div class="command-empty">Chưa tìm thấy màn hình phù hợp.<br>Thử tên ngắn hơn hoặc bỏ bộ lọc phân hệ.</div>';
 $('command-matches').textContent=commandResults.length+' kết quả';
}
function openCommandScreen(index){const screen=commandResults[index];if(!screen)return;closeScreenSearch(false);go(screen.id);requestAnimationFrame(()=>{$('screen-search').focus()})}
function refreshNavigation(){
 if(!cur)return;lastPlatformScreen[cur.platform]=cur.id;
 recentScreens=[cur.id,...recentScreens.filter(id=>id!==cur.id)].slice(0,8);try{localStorage.setItem('public-investment-recent',JSON.stringify(recentScreens))}catch{}
 ['web','mobile'].forEach(p=>$('platform-'+p).setAttribute('aria-pressed',String(cur.platform===p)));
 $('current-screen-id').textContent=cur.id+' · '+(cur.platform==='web'?'Web':'iOS / Android');$('current-screen-title').textContent=cur.title;
 $('view-indicator').hidden=$('state').value==='normal';$('view-options').title=$('state').value==='normal'?'Tùy chọn xem':'Đang mô phỏng: '+$('state').selectedOptions[0].text;
 if($('catalog').classList.contains('hidden')){$('catalog').classList.remove('command-mode');$('screen-search').setAttribute('aria-expanded','false')}
 const innerSearch=document.querySelector('.searchtop');if(innerSearch)innerSearch.innerHTML='⌕ Tìm nhanh hồ sơ';
}
const renderBeforeNavigation=render;render=function(){renderBeforeNavigation();refreshNavigation()};
new ResizeObserver(()=>document.documentElement.style.setProperty('--studio-height',document.querySelector('.studio').getBoundingClientRect().height+'px')).observe(document.querySelector('.studio'));
new MutationObserver(()=>{if(!$('catalog').querySelector('.command-dialog')){$('catalog').classList.remove('command-mode');$('screen-search').setAttribute('aria-expanded','false')}}).observe($('catalog'),{childList:true});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#view-panel,#view-options')&&!$('view-panel').hidden){$('view-panel').hidden=true;$('view-options').setAttribute('aria-expanded','false')}if(event.target===$('catalog')&&$('catalog').classList.contains('command-mode'))closeScreenSearch()});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){if(!$('catalog').classList.contains('hidden')&&$('catalog').classList.contains('command-mode')){event.preventDefault();closeScreenSearch()}else if(!$('view-panel').hidden){event.preventDefault();toggleViewOptions(false)}return}
 if(!$('catalog').classList.contains('command-mode')||$('catalog').classList.contains('hidden'))return;
 const source=document.activeElement;
 if((event.key==='ArrowDown'||event.key==='ArrowUp')&&(source?.id==='command-query'||source?.classList.contains('command-result'))){event.preventDefault();if(!commandResults.length)return;commandIndex=(commandIndex+(event.key==='ArrowDown'?1:-1)+commandResults.length)%commandResults.length;document.querySelectorAll('.command-result').forEach((b,i)=>b.dataset.active=String(i===commandIndex));document.querySelector(`.command-result[data-index="${commandIndex}"]`)?.scrollIntoView({block:'nearest'});if(source?.classList.contains('command-result'))document.querySelector(`.command-result[data-index="${commandIndex}"]`).focus()}
 if(event.key==='Enter'&&source?.id==='command-query'){event.preventDefault();openCommandScreen(commandIndex)}
 if(event.key==='Tab'){const controls=[...$('catalog').querySelectorAll('button,input,select')].filter(e=>e.getClientRects().length),first=controls[0],last=controls.at(-1);if(event.shiftKey&&source===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&source===last){event.preventDefault();first.focus()}}
});
refreshNavigation();
if($('screen-total'))$('screen-total').textContent=SCREENS.length+' màn hình · Dữ liệu và tương tác minh họa.';
