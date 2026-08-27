/* Titan Canyon shared formation registry.
   Data-only. No DOM access. Assigns globals for consumption by titan-guide.html,
   titan-battle-plan.html, titan-admin.html, etc. */
(function(){
  // ---- ported builders (verbatim from titan-guide.html:689-731) ----
  function isB(x,y){return x>=3&&x<=4&&y>=3&&y<=4;}
  function isI(x,y){return x>=2&&x<=5&&y>=2&&y<=5&&!isB(x,y);}
  function isO(x,y){return !isB(x,y)&&!isI(x,y);}
  function blocks(){var b=[];for(var bx=0;bx<8;bx+=2)for(var by=0;by<8;by+=2){
    if(isO(bx,by)&&isO(bx+1,by)&&isO(bx,by+1)&&isO(bx+1,by+1))b.push([bx,by]);}return b;}
  function corner(bx,by){return (bx===0||bx===6)&&(by===0||by===6);}
  function inner(){var c=[];for(var x=2;x<=5;x++)for(var y=2;y<=5;y++)if(isI(x,y))c.push([x,y]);return c;}
  function build(o){
    var els=[],s={big:0,small:0,tower:0};
    els.push({x:3,y:3,w:2,h:2,t:'repo',l:'REPO'});
    blocks().forEach(function(bl){var bx=bl[0],by=bl[1],k=corner(bx,by)?o.corners:o.outer;
      if(k==='B'){els.push({x:bx,y:by,w:2,h:2,t:'base',l:''});s.big++;}
      else{for(var dx=0;dx<2;dx++)for(var dy=0;dy<2;dy++){els.push({x:bx+dx,y:by+dy,w:1,h:1,t:k==='T'?'tower':'sbase',l:''});k==='T'?s.tower++:s.small++;}}});
    inner().forEach(function(c){els.push({x:c[0],y:c[1],w:1,h:1,t:o.inner==='T'?'tower':'sbase',l:''});o.inner==='T'?s.tower++:s.small++;});
    s.players=s.big+s.small;s.mm=Math.ceil(s.tower/5);
    return {els:els,s:s};
  }
  function buildBlock1MM(){
    var els=[],s={big:0,small:0,tower:0,ce:0};
    els.push({x:3,y:3,w:2,h:2,t:'repo',l:'REPO'});
    [[3,0,'MM'],[0,3,''],[6,3,''],[3,6,'']].forEach(function(b){els.push({x:b[0],y:b[1],w:2,h:2,t:'base',l:b[2]});s.big++;});
    [[1,1],[6,1],[1,6],[6,6]].forEach(function(t){els.push({x:t[0],y:t[1],w:1,h:1,t:'tower',l:''});s.tower++;});
    s.players=s.big;s.mm=1;
    return {els:els,s:s};
  }

  // ---- normalize builder els -> {bases,towers,hub} in deployed grid-area form ----
  function areaOf(e){ return (e.y+1)+'/'+(e.x+1)+'/'+(e.y+1+e.h)+'/'+(e.x+1+e.w); }
  function normalize(r){
    var bases=[], towers=[], hub=null, i=0;
    r.els.slice().sort(function(a,b){ return (a.y-b.y) || (a.x-b.x); }).forEach(function(e){
      var area=areaOf(e);
      if(e.t==='repo'){ hub=area; }
      else if(e.t==='base'||e.t==='ce'){ bases.push({id:'b'+(++i), area:area, size:'big',
        role: (e.l==='MM')?'MM':((e.t==='ce'||e.l==='CE')?'CE':null), label:'Base'}); }
      else if(e.t==='sbase'){ bases.push({id:'b'+(++i), area:area, size:'small', role:null, label:'Base'}); }
      else if(e.t==='tower'){ towers.push({area:area, glyph:'T'}); }
    });
    return { bases:bases, towers:towers, hub:hub, players:r.s.players, mms:r.s.mm };
  }

  // ---- Standard: the deployed literal (NOT buildGapped) ----
  var STANDARD = {
    key:'standard', label:'Standard Formation',
    short:'8 players around the building, a tower in every gap. Nothing left open.',
    explanation:'The battle-plan standard. 8 players spaced around the building, 6 MMs (who also build the ~28 gap towers) plus 2 CE, with a tower in every gap. Nothing is left open.',
    players:8, mms:6, reco:true,
    bases:[
      {id:'1',area:'4/1/6/3',size:'big',role:'CE',label:'Bigger CE'},
      {id:'2',area:'4/7/6/9',size:'big',role:'CE',label:'Med-strong CE'},
      {id:'3',area:'7/1/9/3',size:'big',role:'MM',label:'MM + UC'},
      {id:'4',area:'1/1/3/3',size:'big',role:'MM',label:'MM + UC'},
      {id:'5',area:'7/7/9/9',size:'big',role:'MM',label:'MM + UC'},
      {id:'6',area:'1/7/3/9',size:'big',role:'MM',label:'MM + UC'},
      {id:'7',area:'7/4/9/6',size:'big',role:'MM',label:'Any MM ×4'},
      {id:'8',area:'1/4/3/6',size:'big',role:'MM',label:'Any MM ×4'}
    ],
    towers: [
      ['3/3/4/4','U'],['3/6/4/7','U'],['6/3/7/4','U'],['6/6/7/7','U'],
      ['3/4/4/5','W'],['3/5/4/6','W'],['4/3/5/4','W'],['5/3/6/4','W'],['4/6/5/7','W'],['5/6/6/7','W'],['6/4/7/5','W'],['6/5/7/6','W'],
      ['3/1/4/2','S'],['3/2/4/3','S'],['3/7/4/8','S'],['3/8/4/9','S'],['6/1/7/2','S'],['6/2/7/3','S'],['6/7/7/8','S'],['6/8/7/9','S'],
      ['1/3/2/4','S'],['2/3/3/4','S'],['7/3/8/4','S'],['8/3/9/4','S'],['1/6/2/7','S'],['2/6/3/7','S'],['7/6/8/7','S'],['8/6/9/7','S']
    ].map(function(t){ return {area:t[0], glyph:t[1]}; }),
    hub:'4/4/6/6'
  };

  function alt(key,label,short,explanation,reco,r){
    var n=normalize(r);
    return { key:key, label:label, short:short, explanation:explanation, reco:reco,
             players:n.players, mms:n.mms, bases:n.bases, towers:n.towers, hub:n.hub };
  }

  var FORMATIONS = [
    STANDARD,
    alt('core-tower-ring','Core Tower Ring','12 big bases on the border, a full tower ring wrapping the building.',
        'Twelve big bases on the border and a full tower ring wrapping the building. Towers guard the last step to the capture point.',
        true, build({outer:'B',corners:'B',inner:'T'})),
    alt('reinforced-corners','Reinforced Corners','Tower the four corners too, plus the core ring.',
        'More MMs to spare? Tower the four corners, the favourite teleport spots, plus the core ring.',
        false, build({outer:'B',corners:'T',inner:'T'})),
    alt('all-bases','All Bases','12 big on the ring, 12 small hugging the building. No MMs needed.',
        'No Mechanical Masters? Fully seal it with player bases: 12 big on the ring, 12 small hugging the building.',
        false, build({outer:'B',corners:'B',inner:'s'})),
    alt('block-2x2-1mm','2×2 Block · 1 MM','4 bases plus one MM’s 4 towers seal every 2×2 square.',
        'Short on Mechanical Masters? One MM drops 4 towers into the inner corners while 4 players (the MM plus 3 others) hold the edge-midpoint 2×2 bases. Every 2×2 square is sealed. Just 4 people, versus 8 with no MM at all.',
        false, buildBlock1MM())
  ];

  window.TITAN_FORMATIONS = FORMATIONS;
  window.TITAN_FORMATION_BY_KEY = FORMATIONS.reduce(function(m,f){ m[f.key]=f; return m; }, {});
  window.TITAN_TOWER_GLYPH = { U:'✚', W:'🚨', S:'💪', T:'🗼' };
  window.titanFormationKey = function(sq){ var k=sq&&sq.formation; return (k && window.TITAN_FORMATION_BY_KEY[k]) ? k : 'standard'; };
  window.titanAssignmentFor = function(sq,key,id){ if(!key||key==='standard'){ return (sq&&sq.positions&&sq.positions[id])||''; } return (sq&&sq.formationFill&&sq.formationFill[id])||''; };
})();
