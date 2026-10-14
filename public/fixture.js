const status=document.querySelector('#interaction-status');
if(new URLSearchParams(location.search).has('frame')){document.body.replaceChildren();const title=document.createElement('h2');title.textContent='Embedded contact form';const label=document.createElement('label');label.textContent='Company ';const input=document.createElement('input');input.name='company';label.append(input);const button=document.createElement('button');button.textContent='Save company';const output=document.createElement('output');button.onclick=()=>output.textContent='Company saved: '+input.value;document.body.append(title,label,button,output);}else {
  document.querySelector('#contact-form').onsubmit=event=>{event.preventDefault();document.querySelector('#form-status').textContent='Local form submitted';};
  document.querySelector('#menu-item').onclick=()=>status.textContent='Menu item chosen';
  document.querySelector('#double-click').ondblclick=()=>status.textContent='Double-click received';
  document.querySelector('#right-click').oncontextmenu=event=>{event.preventDefault();status.textContent='Right-click received';};
  document.querySelector('#keyboard-search').onkeydown=event=>{if(event.key==='Enter')status.textContent='Searched: '+event.target.value;};
  document.querySelector('#dialog').onclick=()=>status.textContent=confirm('Confirm this local test action?')?'Confirmed':'Dismissed';
  document.querySelector('#drag-source').ondragstart=event=>event.dataTransfer.setData('text/plain','Test card');
  document.querySelector('#drop-zone').ondragover=event=>event.preventDefault();
  document.querySelector('#drop-zone').ondrop=event=>{event.preventDefault();event.currentTarget.textContent='Dropped: '+event.dataTransfer.getData('text/plain');};
  for(const [id,mode]of [['open-shadow','open'],['closed-shadow','closed']]){const root=document.querySelector('#'+id).attachShadow({mode});const button=document.createElement('button');button.textContent=mode+' shadow button';button.onclick=()=>button.textContent=mode+' shadow clicked';root.append(button);}
  document.querySelector('#upload').onchange=event=>document.querySelector('#form-status').textContent='Attached '+[...event.target.files].map(f=>f.name).join(', ');
}
