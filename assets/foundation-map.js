/* ============================================================================
   foundation-map.js — the shared LACC foundation-plan canvas engine
   ----------------------------------------------------------------------------
   Extracted verbatim from cup-dashboard/index.html (lines 945-2247) so that
   cup-dashboard, look-ahead (SuperYap) and command-center all render the SAME
   map from the SAME code instead of forking it.

   Requires (loaded BEFORE this file):
     foundation_geo.js   -> window.FOUNDATION_GEO   (real digitized plan geometry)
   Optional:
     anime.js            -> window.anime            (flourishes; guarded everywhere)

   Exposes a single global:  window.OYFoundationMap
     OYFoundationMap.create(opts) -> a map instance (see the return block at the
     bottom of createFoundationMap for the full API).

   HOST HOOKS. The engine calls a handful of functions that only the CUP
   dashboard defines (pour modals, the mix library, pour numbering). Every one of
   those call sites is `typeof`-guarded, so in a host that does not define them
   the affected affordance simply does nothing:
     cupPourNo, showAddFoundationPourModal, promptPourName, deleteFoundationPour,
     setFoundationPourColor, setFoundationPourCategory, showFootingTypesModal,
     renderFootingTypesModal, exportFootingMapStatus, getMixDesigns, foundationPours
   The two helpers that were NOT guarded (mdFromIso, hexToRgbCsv) are pure
   one-liners and are inlined below as _fmMdFromIso / _fmHexToRgbCsv.
   ============================================================================ */
(function () {
  "use strict";

  // ── inlined from cup-dashboard (were host globals, are pure) ──
  function _fmMdFromIso(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? (parseInt(m[2], 10) + '/' + parseInt(m[3], 10)) : (iso || ''); }
  function _fmHexToRgbCsv(hex){ const n=parseInt(String(hex||'').replace('#',''),16); if(isNaN(n)) return ''; return ((n>>16)&255)+','+((n>>8)&255)+','+(n&255); }

// ════════════════════════════════════════════════════════════════════════════
// CANVAS FOUNDATION MAP ENGINE  (ported from the design handoff prototype)
// Real foundation-plan geometry (window.FOUNDATION_GEO) drawn on one <canvas>:
// pan/zoom, sequence/status coloring, footing search, draw-to-assign. ONE shared
// instance, re-mounted into the Sequences card and the Footing-map tab.
// Pour groupings are seeded (k-means) then refinable; membership persists to the
// CUP-private Firebase path cup-foundation/footingPours (never embed-tracker).
// ════════════════════════════════════════════════════════════════════════════
const FND_SEQCOL = { '0':'#38bdf8','0.5':'#2dd4bf','1':'#22d3ee','2':'#a78bfa','3':'#fbbf24' };
const FND_STAT = { complete:['Complete','#34d399'], progress:['In progress','#fbbf24'], scheduled:['Scheduled','#38bdf8'], unplaced:['Unassigned','#64748b'] };
const FND_POUR_STATUS = { PENDING:'scheduled', ORDERED:'progress', COMPLETE:'complete' };  // dashboard enum → engine status
const FND_SWATCHES = ['#38bdf8','#2dd4bf','#22d3ee','#a78bfa','#fbbf24','#34d399','#f87171','#f472b6','#fb923c','#e2e8f0'];
// Pour-color picker palette — deliberately EXCLUDES the footing-TYPE hues (F #ec4899, PC #a78bfa,
// MPC #fbbf24, GB #5b6b86) and rat-slab pink #f472b6, so a pour color can't be mistaken for a property color.
const FND_POUR_SWATCHES = ['#38bdf8','#22d3ee','#2dd4bf','#34d399','#a3e635','#fb923c','#f87171','#60a5fa','#94a3b8','#e2e8f0'];
const FND_STATUS_BY_AREA = { '0':'complete','0.5-1':'complete','0.5-2':'complete','1':'complete','3-3':'progress','3-4':'progress','2-9':'progress','1-5':'scheduled','1-6':'scheduled','2-7':'scheduled','3-8':'scheduled' };
// Footing-type families → color (used for the lively "general idea" preview when nothing is assigned yet)
const FND_TYPECOL = { F:'#ec4899', PC:'#a78bfa', MPC:'#fbbf24', GB:'#5b6b86' };   // F (spread footings) = magenta-pink — complements the violet pile caps, distinct from rat-slab pink + completed green
function fndTypeCol(t){ t=String(t).toUpperCase(); if(t.indexOf('MPC')===0)return FND_TYPECOL.MPC; if(t.indexOf('PC')===0)return FND_TYPECOL.PC; if(t.charAt(0)==='F')return FND_TYPECOL.F; if(t.indexOf('GB')===0)return FND_TYPECOL.GB; return '#64748b'; }
// Engineered footing dimensions from the LACC "Footing Types" schedule (CSV import).
// wFt = Width (ft), lFt = Length (ft), thk = Depth (in = depth-ft × 12). Blank = not specified
// (grade beams are per-LF, so length is left to the drawn span). This is the built-in default
// layer: it drives every footing's size + takeoff unless a per-footing or saved type override exists.
const FOOTING_TYPE_LIBRARY = {'F6':{wFt:6,lFt:6,thk:24}, 'F6A':{wFt:9,lFt:6,thk:36}, 'F7':{wFt:7,lFt:7,thk:27}, 'F7A':{wFt:7,lFt:4.5,thk:54}, 'F8':{wFt:8,lFt:8,thk:30}, 'F8A':{wFt:8,lFt:8,thk:36}, 'F9':{wFt:9,lFt:9,thk:36}, 'F10':{wFt:10,lFt:10,thk:39}, 'F10A':{wFt:15,lFt:10,thk:51}, 'F11':{wFt:11,lFt:11,thk:42}, 'F12':{wFt:12,lFt:12,thk:45}, 'F12B':{wFt:12,lFt:12,thk:54}, 'F12C':{wFt:29.33,lFt:12,thk:54}, 'F14':{wFt:14,lFt:14,thk:54}, 'WF1':{wFt:2,thk:12}, 'GB1':{wFt:2,thk:24}, 'GB2':{wFt:3.5,thk:36}, 'GB3':{wFt:3,thk:36}, 'GB4':{wFt:3,lFt:1,thk:96}, 'GB5':{wFt:3,thk:36}, 'GB6':{wFt:3.5,thk:72}, 'GB7':{wFt:3.5,thk:66}, 'GB8':{wFt:3.5,thk:60}, 'GB9':{wFt:3.5,thk:45}, 'GB10':{wFt:3.5,thk:69}, 'PC1A':{wFt:3.5,lFt:3.5,thk:42}, 'PC1B':{wFt:3.5,lFt:3.5,thk:42}, 'PC1C':{wFt:3.5,lFt:3.5,thk:42}, 'PC1D':{wFt:3.5,lFt:3.5,thk:42}, 'PC2A':{wFt:3.5,lFt:9.5,thk:60}, 'PC2B':{wFt:3.5,lFt:9.5,thk:60}, 'PC2C':{wFt:3.5,lFt:9.5,thk:60}, 'PC2D':{wFt:3.5,lFt:9.5,thk:60}, 'PC2E':{wFt:3.5,lFt:9.5,thk:60}, 'PC2F':{wFt:3.5,lFt:9.5,thk:60}, 'PC2G':{wFt:3.5,lFt:9.5,thk:90}, 'PC2H':{wFt:7,lFt:19,thk:48}, 'PC2J':{wFt:3.5,lFt:12.125,thk:60}, 'PC2K':{wFt:6,lFt:18,thk:96}, 'PC3A':{wFt:9,lFt:10,thk:60}, 'PC3E':{wFt:9,lFt:10,thk:60}, 'PC4A':{wFt:9.5,lFt:9.5,thk:66}, 'PC4C':{wFt:9.5,lFt:9.5,thk:66}, 'PC4D':{wFt:9.5,lFt:9.5,thk:66}, 'PC4E':{wFt:9.5,lFt:9.5,thk:66}, 'PC4F':{wFt:9.5,lFt:9.5,thk:66}, 'PC4G':{wFt:18,lFt:18,thk:96}, 'PC6A':{wFt:9.5,lFt:15.5,thk:72}, 'PC6C':{wFt:9.5,lFt:15.5,thk:72}, 'PC6D':{wFt:9.5,lFt:15.5,thk:72}, 'PC6E':{wFt:9.5,lFt:15.5,thk:72}, 'PC6F':{wFt:9.5,lFt:15.5,thk:72}, 'PC6G':{wFt:9.5,lFt:15.5,thk:90}, 'PC8A':{wFt:12,lFt:20.5,thk:96}, 'PC8E':{wFt:12,lFt:20.5,thk:96}, 'PC8F':{wFt:12,lFt:20.5,thk:96}, 'PC8G':{wFt:4,lFt:21.5,thk:78}, 'PC8H':{wFt:9.5,lFt:23.5,thk:72}, 'PC9A':{wFt:10.417,lFt:30,thk:120}, 'PC10A':{wFt:9.5,lFt:27.5,thk:66}, 'PC15A':{wFt:35.5,lFt:98,thk:96}, 'PC45E':{wFt:15.5,lFt:87.5,thk:72}, 'MPC1':{wFt:2.5,lFt:2.5,thk:36}, 'MPC4A':{wFt:7,lFt:7}, 'MPC4B':{wFt:7,lFt:7,thk:54}, 'MPC6A':{wFt:7,lFt:11,thk:66}, 'MPC6B':{wFt:7,lFt:11,thk:66}, 'MPC6C':{wFt:7,lFt:11,thk:96}, 'MPC8A':{wFt:7,lFt:15,thk:75}, 'MPC8B':{wFt:7,lFt:15,thk:60}, 'MPC9A':{wFt:11,lFt:11,thk:60}, 'MPC9B':{wFt:11,lFt:11,thk:60}, 'MPC10A':{wFt:7,lFt:19,thk:66}, 'MPC18A':{thk:69.96}, 'MPC39A':{thk:75.96}, 'MPC6A-R':{wFt:11,lFt:20,thk:72}, 'MPC6B-R':{wFt:11,lFt:20,thk:75.96}, 'MPC8A-R':{wFt:14.5,lFt:15,thk:63.96}, 'MPC10A-R':{wFt:19,lFt:20,thk:75.96}, 'MPC12A-R':{wFt:20,lFt:20,thk:75.96}, 'MPC14A-R':{wFt:20,lFt:20,thk:75.96}, 'CP1':{wFt:3.5,lFt:3.5}, '12" Pit Slab':{wFt:17.1,lFt:20.75,thk:12}, '18" Pit Slab':{wFt:20,lFt:20,thk:18}, '5 x 2.5':{wFt:2.5,lFt:5,thk:24}, 'PC15A Mini':{wFt:15,lFt:17.5,thk:96}};

// ════════════════════════════════════════════════════════════════════════════
// EQUIPMENT ICONS — one source of truth for the map AND the host's panels.
// Each icon is authored in a 24×24 box:  f = filled subpaths (SVG path data),
// c = filled circles [cx,cy,r],  s = [path, strokeWidth] (round caps/joins).
// The canvas draws them with Path2D; the host renders the SAME data as inline
// SVG via OYFoundationMap.iconSvg(), so a rig looks identical in the sidebar,
// the legend and on the map. Single-color silhouettes — they tint to whatever
// the crew color is and stay legible down to ~14px.
// ════════════════════════════════════════════════════════════════════════════
const SEQ_ICONS = {
    excavator:  { f:['M2.2 17.6h11a2 2 0 0 1 0 4h-11a2 2 0 0 1 0-4z','M3.4 10.6h5.2a1.1 1.1 0 0 1 1.1 1.1v5.2H2.3v-5.2a1.1 1.1 0 0 1 1.1-1.1z','M16.6 12.1h5.2l-.9 3.4a1.8 1.8 0 0 1-1.7 1.3h-1.4a1.8 1.8 0 0 1-1.7-1.3z'], s:[['M9.9 12.6 L15.4 7.4 L18.9 12.4',2]] },
    breaker:    { f:['M2.2 17.6h11a2 2 0 0 1 0 4h-11a2 2 0 0 1 0-4z','M3.4 10.6h5.2a1.1 1.1 0 0 1 1.1 1.1v5.2H2.3v-5.2a1.1 1.1 0 0 1 1.1-1.1z','M16.6 10.8h4v5.4h-4z','M17.9 16.2h1.4l-.7 3.6z'], s:[['M9.9 12.6 L15 7 L18.6 10.8',2],['M15.4 19.4 L14 20.8 M21.4 19.4 L22.4 20.8',1.3]] },
    acp:        { f:['M1.6 18.2h9.6a1.9 1.9 0 0 1 0 3.8H1.6a1.9 1.9 0 0 1 0-3.8z','M2.6 13.2h6.6v4.6H2.6z','M13.4 1.6h4.6v2h-4.6z'], s:[['M15.7 2.4 L15.7 20.4',2],['M9.2 14 L14.6 5.6',1.5],['M12.8 5.6 L18.6 7.6',1.5],['M12.8 9.2 L18.6 11.2',1.5],['M12.8 12.8 L18.6 14.8',1.5],['M12.8 16.4 L18.6 18.4',1.5]] },
    drill:      { f:['M1.6 18.2h9.6a1.9 1.9 0 0 1 0 3.8H1.6a1.9 1.9 0 0 1 0-3.8z','M2.6 13.2h6.6v4.6H2.6z','M12.8 1.8h6v2.2h-6z','M12.6 7.4h6.4v2.6h-6.4z','M14.4 17.2h2.8l-1.4 3.4z'], s:[['M15.8 4 L15.8 17.4',2.2],['M9.2 14 L13 6.8',1.5],['M12.4 20.8 L19.2 20.8',1.6]] },
    shoring:    { f:['M4.4 3.4h2.4v18h-2.4z','M10.8 3.4h2.4v18h-2.4z','M17.2 3.4h2.4v18h-2.4z'], s:[['M3 6.6 L21 6.6',1.6],['M3 11 L21 11',1.6],['M3 15.4 L21 15.4',1.6],['M3 19.8 L21 19.8',1.6]] },
    crane:      { f:['M2.2 18.2h10.6a1.9 1.9 0 0 1 0 3.8H2.2a1.9 1.9 0 0 1 0-3.8z','M3 13.4h6.4v4.4H3z','M17.6 12.4h2.6v2.6h-2.6z'], s:[['M6.8 13.2 L18.9 3.2',2],['M18.9 3.6 L18.9 12.4',1.5],['M8.6 11.8 L10.4 14.2 M11.6 9.4 L13.4 11.8 M14.6 7 L16.4 9.4',1.1]] },
    mixer:      { f:['M1.8 10.6h3.6l2 3.2v2.8H1.8z','M8.4 15.8 L8.4 9.6 L18 6.4 C20 5.8 21.8 7.2 21.8 9.2 L21.8 12.6 C21.8 14.4 20.4 15.8 18.6 15.8 Z'], c:[[5.4,18.6,2.2],[13.6,18.6,2.2],[18.4,18.6,2.2]], s:[['M10.6 8.8 L11.8 15.8 M14.4 7.6 L15.6 15.8 M18.2 6.6 L19.2 15.6',1]] },
    pump:       { f:['M2 11.8h4.2l1.8 3v2.6H2z','M8.4 14.4h12.4v3H8.4z'], c:[[6.4,18.6,2],[15.2,18.6,2],[19,18.6,2]], s:[['M10 14 L10 5.6 L18.6 3.4',2],['M18.6 3.4 L21.2 8.4',1.8],['M21.2 8.4 L21.2 12.4',1.3]] },
    dozer:      { f:['M2 16.4h11.6a2.2 2.2 0 0 1 0 4.4H2a2.2 2.2 0 0 1 0-4.4z','M3.8 9.4h5.2a1.1 1.1 0 0 1 1.1 1.1v5.4H2.7v-5.4a1.1 1.1 0 0 1 1.1-1.1z','M18.2 8.4h1.4c1.8 3 2.4 7.2 1.8 12h-3.2c.6-4.8 0-9-1.4-12z'], s:[['M11.6 14.6 L17.6 16.4',1.8]] },
    loader:     { f:['M2.6 10h5v6H2.6z','M8 8.2h3.6a1 1 0 0 1 1 1V16H8z','M16.6 13.6h5.2v1.6l-1.4 3.6h-3.8z'], c:[[5.6,17.8,2.6],[12.4,17.8,2.6]], s:[['M12.4 11.4 L17.2 13.6',1.9]] },
    roller:     { f:['M2.8 9.2h8.4a1.1 1.1 0 0 1 1.1 1.1v5H2.8z','M12.4 12.4h3v2.6h-3z'], c:[[5.6,17.8,2.4],[18,16.4,4]] },
    dump:       { f:['M2 11.6h3.8l1.8 2.8v2.6H2z','M8.6 11.4h12.6v5.6H8.6z','M9.8 11.4c1.4-2.2 3.2-3.4 5.1-3.4s3.7 1.2 5.1 3.4z'], c:[[5.6,19,2.2],[13.8,19,2.2],[18.6,19,2.2]] },
    crew:       { f:['M4.6 14.6c0-4.2 3.3-7.6 7.4-7.6s7.4 3.4 7.4 7.6v.8H4.6z','M2 15.4h20v2.8H2z'], s:[['M12 7.2 L12 4',1.8]] },
    survey:     { f:['M7.8 5.4h7.2v3.6H7.8z','M15 6.2h4.2v2h-4.2z'], s:[['M11.4 9 L11.4 11.6',1.6],['M11.4 11.6 L6 21 M11.4 11.6 L11.4 21 M11.4 11.6 L16.8 21',1.5]] },
};
// Picker order + plain-English names (what a super would call the thing).
const SEQ_ICON_LIST = [
  ['excavator','Excavator'], ['breaker','Demo hammer'], ['acp','ACP / auger rig'], ['drill','Drill rig'],
  ['shoring','Shoring wall'],  ['crane','Crane'],       ['mixer','Mixer truck'],   ['pump','Pump truck'],
  ['dozer','Dozer'],           ['loader','Loader'],     ['roller','Compactor'],    ['dump','Dump truck'],
  ['crew','Crew'],             ['survey','Survey'],
];
// Sensible default per activity, so an untouched crew already shows the right rig.
const SEQ_ACT_ICON = { acp:'acp', shoring:'drill', excavate:'excavator', pour:'mixer', backfill:'dozer' };
function seqIconName(c){ if(!c) return null; const k=c.icon||SEQ_ACT_ICON[c.activity]; return SEQ_ICONS[k]?k:null; }
// Inline SVG of the same paths — for HTML panels (no <img>, no network).
function seqIconSvg(name, size, color, cls){
  const ic=SEQ_ICONS[name]; if(!ic) return '';
  const col=color||'currentColor';
  let p='';
  (ic.f||[]).forEach(d=>{ p+=`<path d="${d}" fill="${col}"/>`; });
  (ic.c||[]).forEach(c=>{ p+=`<circle cx="${c[0]}" cy="${c[1]}" r="${c[2]}" fill="${col}"/>`; });
  (ic.s||[]).forEach(s=>{ p+=`<path d="${s[0]}" fill="none" stroke="${col}" stroke-width="${s[1]}" stroke-linecap="round" stroke-linejoin="round"/>`; });
  return `<svg class="${cls||''}" width="${size||18}" height="${size||18}" viewBox="0 0 24 24" style="flex:none;display:block">${p}</svg>`;
}

function createFoundationMap(opts){
  opts = opts || {};
  const st = { mode:'explore', colorMode:opts.colorMode||'status', filter:'ALL', hideComplete:(localStorage.getItem('cup_fnd_hidedone')==='1'), showNames:(localStorage.getItem('cup_fnd_shownames')==='1'), showDates:(localStorage.getItem('cup_fnd_showdates')==='1'), hideRatslab:(localStorage.getItem('cup_fnd_hideratslab')==='1'), selId:null, zoomPct:100, tool:'none', markColor:'#fbbf24', seqTool:'none' };
  const RATSLAB_COL = '#f472b6';   // distinct category color for rat slab pours (pink — not a sequence/status hue)
  // geometry / render state
  let footings=null, pours=null, pourById=null, byNo=null, gridCols=null, gridRows=null;
  let ox=0, oy=0, planW=0, planH=0, colPitch=73, rowPitch=72, siteHull=null;
  let underlay=null, ctx=null;
  let tx=0, ty=0, scale=1, base=1, cssW=0, cssH=0, _fitMargin=46, _typeColor=false, _introT=0, _introPlayed=false;
  const PAN_SENS=0.6, WHEEL_ZOOM=0.0010;   // navigation feel — lower PAN_SENS = slower middle-mouse pan; lower WHEEL_ZOOM = gentler scroll-zoom
  const dpr=Math.min(2, window.devicePixelRatio||1);
  let pointers=new Map(), drag=null, band=null, flash=null, _pinch=null, _moved=false;
  let _raf=0, _ro=null, _fitted=false, _wired=false, _built=false, _showPanel=false, _keyWired=false;
  let _membershipCb=null, _saveTimer=0, _pendingMembership=null;
  let _poursExt=null;                                          // external pour set (from foundationPours)
  let markups=[], _markupCb=null, _markupTimer=0, _markDraft=null, _markBand=null, _markDrag=null, selMarkupId=null;
  let _takeoffCb=null;
  let _footStatus={}, _footToggleCb=null, _bulkDoneCb=null, pulses=[];   // per-footing DONE (shared footings/fnd{no} store) + tap pulse rings
  let _baseFoot=null, _footEdits=null, _footEditCb=null, _footEditTimer=0, selFootingNo=null, _locked=true, _footDrag=null;
  let _typeDefs=null, _typeDefCb=null, _typeDefTimer=0;     // type-level property library (cup-foundation/footingTypes)
  let _lastAddType='F8', _markResize=null, _addFilter='';    // add-footing armed type · region-markup corner resize · type-picker filter
  let _groupDrag=null;                                        // dragging a whole multi-selection at once
  let selFootings=new Set(), _selBand=null, _spaceDown=false;
  let clipboard=null, undoStack=[];
  // DOM refs
  let root=null, mapArea=null, canvas=null, tip=null, panelHost=null, searchEl=null, zoomLabelEl=null;
  let elModeExplore=null, elModeAssign=null, elColorStatus=null, elColorSeq=null, elChips=null, modeHintEl=null, headlineEl=null;
  let toolbarEl=null, subbarEl=null, hintBarEl=null, toolsRowEl=null, swatchesEl=null;

  // ───────── pure helpers ─────────
  const hex2rgba=(h,a)=>{ h=String(h||''); if(h.charAt(0)==='#'){ const n=parseInt(h.slice(1),16); return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`; } const m=/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(h); if(m) return `rgba(${m[1]},${m[2]},${m[3]},${a})`; return `rgba(148,163,184,${a})`; };   // accepts #hex or rgb()/rgba() (custom pour colors are stored as rgb())
  const fmt=(n)=>Math.round(n).toLocaleString();
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const seqOf=(area)=>{ if(!area) return null; if(area.indexOf('0.5')===0) return '0.5'; return area.split('-')[0]; };
  function sideFt(t){
    t=String(t).toUpperCase();
    const F={F6:5,F6A:5,F7:5.5,F7A:6,F8:6.5,F8A:7,F9:7.5,F10:8,F10A:8.5,F11:9,F12:9.5,F12B:10,F12C:10,F14:11,F201:6,F202:6};
    if(F[t]!=null) return F[t];
    if(t.indexOf('MPC')===0){ const n=parseInt(t.replace(/\D/g,''))||6; return n>=18?26:(n>=8?22:(n>=6?20:18)); }
    if(t[0]==='F') return 6.5;
    if(t.indexOf('PC')===0){ const n=parseInt(t.slice(2))||2; const m={1:8,2:10,3:10.5,4:11,6:12,8:14,9:16,10:12,15:16,45:12}; return m[n]||10; }
    if(t.indexOf('GB')===0) return 3;
    return 7;
  }
  function median(a){ if(!a||!a.length)return 0; const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; }
  function clusterLines(vals,gap){ const v=[...vals].sort((a,b)=>a-b); if(!v.length)return[]; const out=[]; let sum=v[0],cnt=1;
    for(let i=1;i<v.length;i++){ if(v[i]-v[i-1]>gap){ out.push({c:sum/cnt,n:cnt}); sum=0;cnt=0; } sum+=v[i]; cnt++; }
    out.push({c:sum/cnt,n:cnt}); return out; }
  function phaseOf(centers,pitch){ if(!centers.length)return 0; const m=centers.map(c=>((c%pitch)+pitch)%pitch); return median(m); }
  function convex(pts,pad){
    if(pts.length<3) return pts.slice();
    const p=pts.map(q=>[q[0],q[1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
    const lo=[]; for(const q of p){ while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop(); lo.push(q); }
    const hi=[]; for(let i=p.length-1;i>=0;i--){ const q=p[i]; while(hi.length>=2&&cr(hi[hi.length-2],hi[hi.length-1],q)<=0)hi.pop(); hi.push(q); }
    let h=lo.slice(0,-1).concat(hi.slice(0,-1));
    if(pad){ const cx=h.reduce((s,q)=>s+q[0],0)/h.length, cy=h.reduce((s,q)=>s+q[1],0)/h.length;
      h=h.map(q=>{ const dx=q[0]-cx,dy=q[1]-cy,d=Math.hypot(dx,dy)||1; return [q[0]+dx/d*pad, q[1]+dy/d*pad]; }); }
    return h;
  }

  // ───────── data ─────────
  function recompFoot(f){ const w=Math.max(0.5,+f.wFt||1), l=Math.max(0.5,+f.lFt||1), t=Math.max(0.5,+f.thk||1);
    f.w=Math.max(9, w*2.43); f.h=Math.max(9, l*2.43); f.cyv=+(((w*l*(t/12))/27).toFixed(2)); }
  // Rebuild the live footings array from the immutable base + CUP-private edits (cup-foundation/footingEdits).
  // dimension precedence for a footing of `type`:
  //   explicit per-footing edit > saved type override > built-in CSV library > drawn fallback
  function dimFor(field, type, e, fallback){
    if(e && e[field]!=null) return +e[field];
    const td=_typeDefs && _typeDefs[type];
    if(td && td[field]!=null && td[field]!=='') return +td[field];
    const bl=(typeof FOOTING_TYPE_LIBRARY!=='undefined') && FOOTING_TYPE_LIBRARY[type];
    if(bl && bl[field]!=null) return +bl[field];
    return fallback;
  }
  function mixFor(type){ const td=_typeDefs && _typeDefs[type]; return (td && td.mix) || null; }
  function materializeFootings(){
    if(!_baseFoot) return;
    const E=_footEdits||{};
    const arr=_baseFoot.map(b=>{ const f=Object.assign({}, b); const e=E[b.no];
      if(e){ if(e.type!=null)f.type=e.type; if(e.cx!=null)f.cx=+e.cx; if(e.cy!=null)f.cy=+e.cy; if(e.note!=null)f.note=e.note; f.del=!!e.deleted; }
      // beam span: use an explicit per-footing override if set (resized), else translate the base span
      if(b.beam){ if(e && e.beam){ f.beam=Object.assign({}, e.beam); }
        else { const dx=f.cx-b.cx, dy=f.cy-b.cy; f.beam={x1:b.beam.x1+dx,y1:b.beam.y1+dy,x2:b.beam.x2+dx,y2:b.beam.y2+dy,horizontal:b.beam.horizontal}; } }
      // width/length/thickness flow from the type library unless this footing has its own override
      f.wFt=dimFor('wFt',f.type,e,b.wFt); f.lFt=dimFor('lFt',f.type,e,b.lFt); f.thk=dimFor('thk',f.type,e,b.thk);
      f.mix=mixFor(f.type);
      recompFoot(f); return f; });
    Object.keys(E).forEach(k=>{ const e=E[k]; if(!e||!e.added) return; const no=+k; const t=e.type||'F8'; const s=sideFt(t);
      const f={ no, type:t, thk:dimFor('thk',t,e,30), cx:+e.cx||planW/2, cy:+e.cy||planH/2, wFt:dimFor('wFt',t,e,s), lFt:dimFor('lFt',t,e,s), tag:'#'+no, note:e.note||'', mix:mixFor(t), pourId:null, seq:null, added:true, del:!!e.deleted, isBeam:false };
      recompFoot(f); arr.push(f); });
    footings=arr; byNo={}; footings.forEach(f=>byNo[f.no]=f);
  }
  function buildData(geo){
    const PAD=80, UPF=2.43;
    const fb=geo.fb; ox=fb.x0-PAD; oy=fb.y0-PAD;
    planW=(fb.x1-fb.x0)+PAD*2; planH=(fb.y1-fb.y0)+PAD*2;
    footings=geo.foot.map((r,i)=>{
      const t=r[0], cx=r[1]-ox, cy=r[2]-oy, thk=r[3]||30; const s=sideFt(t);
      const f={ no:i+1, type:t, thk, cx, cy, wFt:s, lFt:s, tag:'#'+(i+1), note:'', pourId:null, seq:null };
      recompFoot(f); return f;
    });
    const CL=['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q','R','S','T','U','V','W','X','Y','Z'];
    const colC=clusterLines(footings.map(f=>f.cx+ox),34);
    const rowC=clusterLines(footings.map(f=>f.cy+oy),34);
    colPitch=73;
    const gaps=[]; for(let i=1;i<rowC.length;i++){ const g=rowC[i].c-rowC[i-1].c; if(g<110) gaps.push(g); }
    rowPitch=Math.max(58, Math.min(82, median(gaps)||72));
    const colPhase=phaseOf(colC.map(L=>L.c), colPitch);
    const rowPhase=phaseOf(rowC.map(L=>L.c), rowPitch);
    const snapV=(v,phase,pitch)=>Math.round((v-phase)/pitch)*pitch+phase;
    // geo.precise = coordinates are real (digitized from the plan PDF) — keep them exact:
    // skip the lattice-snap + de-collision that the old auto-extracted data needed.
    if(!geo.precise){
      footings.forEach(f=>{ f.cx=snapV(f.cx+ox,colPhase,colPitch)-ox; f.cy=snapV(f.cy+oy,rowPhase,rowPitch)-oy; });
      const occ=new Set(), keyOf=(cx,cy)=>Math.round(cx)+','+Math.round(cy);
      [...footings].filter(f=>!/^GB/i.test(f.type)).sort((a,b)=>b.w-a.w).forEach(f=>{
        const k=keyOf(f.cx,f.cy);
        if(!occ.has(k)){ occ.add(k); return; }
        let placed=false;
        for(let r=1;r<=4 && !placed;r++){
          for(let dx=-r;dx<=r && !placed;dx++) for(let dy=-r;dy<=r && !placed;dy++){
            if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
            const nx=f.cx+dx*colPitch, ny=f.cy+dy*rowPitch, nk=keyOf(nx,ny);
            if(!occ.has(nk)){ f.cx=nx; f.cy=ny; occ.add(nk); placed=true; }
          }
        }
        if(!placed) occ.add(k);
      });
    }
    // Gridlines: use the real digitized grid (geo.vlines / geo.hlines, in page coords) when present,
    // otherwise derive an approximate lattice from footing clusters (legacy behavior).
    if(geo.vlines && geo.hlines){
      gridCols=geo.vlines.map(v=>({x:v.x-ox, l:v.l}));
      gridRows=geo.hlines.map(v=>({y:v.y-oy, l:String(v.l).replace(/^W/,'')}));   // show "34" not "W34"
    } else {
      const colMap=xp=>{ const i=Math.round(6+(xp-1109)/colPitch); return CL[i]||null; };
      const rowMap=yp=>{ const r=Math.round(33-(yp-382)/rowPitch); return (r>=8&&r<=33)?String(r):null; };
      gridCols=[]; for(let xp=colPhase+Math.ceil((ox-colPhase)/colPitch)*colPitch; xp<ox+planW; xp+=colPitch){ const l=colMap(xp); if(l) gridCols.push({x:xp-ox,l}); }
      gridRows=[]; for(let yp=rowPhase+Math.ceil((oy-rowPhase)/rowPitch)*rowPitch; yp<oy+planH; yp+=rowPitch){ const l=rowMap(yp); if(l) gridRows.push({y:yp-oy,l}); }
    }
    footings.forEach(g=>{ g.isBeam=/^GB/i.test(g.type); });
    const maxRun=colPitch*3.4, tolX=colPitch*0.5, tolY=rowPitch*0.5;
    footings.forEach(g=>{ if(!g.isBeam) return;
      let L=null,R=null,U=null,D=null;
      for(const f of footings){ if(f===g||f.isBeam) continue;
        const dx=f.cx-g.cx, dy=f.cy-g.cy;
        if(Math.abs(dy)<tolY && Math.abs(dx)<maxRun){ if(dx<0){ if(!L||f.cx>L.cx)L=f; } else if(dx>0){ if(!R||f.cx<R.cx)R=f; } }
        if(Math.abs(dx)<tolX && Math.abs(dy)<maxRun){ if(dy<0){ if(!U||f.cy>U.cy)U=f; } else if(dy>0){ if(!D||f.cy<D.cy)D=f; } }
      }
      const hSpan=(L&&R)?(R.cx-L.cx):(L?(g.cx-L.cx):(R?(R.cx-g.cx):1e9));
      const vSpan=(U&&D)?(D.cy-U.cy):(U?(g.cy-U.cy):(D?(D.cy-g.cy):1e9));
      const horizontal = hSpan<=vSpan;
      let x1,y1,x2,y2;
      if(horizontal){ y1=y2=g.cy; x1=L?L.cx:(R?R.cx-colPitch:g.cx-colPitch*0.55); x2=R?R.cx:(L?L.cx+colPitch:g.cx+colPitch*0.55); }
      else { x1=x2=g.cx; y1=U?U.cy:(D?D.cy-rowPitch:g.cy-rowPitch*0.55); y2=D?D.cy:(U?U.cy+rowPitch:g.cy+rowPitch*0.55); }
      g.beam={x1,y1,x2,y2,horizontal};
    });
    // snapshot the immutable base (post lattice-snap + beams), then materialize with edits
    _baseFoot=footings.map(f=>({ no:f.no, type:f.type, cx:f.cx, cy:f.cy, thk:f.thk, wFt:f.wFt, lFt:f.lFt, tag:f.tag, note:'', isBeam:f.isBeam, beam:f.beam }));
    materializeFootings();
    rebuildPours();
    siteHull=convex(_baseFoot.map(f=>[f.cx,f.cy]),28);
  }
  // Engine pours come from the shared foundationPours set (via setPours) so map ↔ dashboard
  // ↔ Pour Day stay unified. Footings start unassigned; the user assigns by hand.
  function rebuildPours(){
    const ext=_poursExt||{};
    pours=Object.keys(ext).filter(id=>!ext[id].archived).map(id=>{
      const e=ext[id];
      const seq=(e.sequence!=null&&e.sequence!=='')?String(e.sequence):(e.area?seqOf(e.area):'');
      // Map palette is self-contained: a custom per-pour color ('R,G,B') wins, else the map's own FND_SEQCOL default.
      const _rgbRe=/^\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*$/;
      const color=(e.color&&_rgbRe.test(String(e.color)))?('rgb('+e.color+')'):(FND_SEQCOL[seq]||'#94a3b8');
      return { id, name:e.name||('Pour '+id), seq, color, pour_date:e.pour_date||'', status:(FND_POUR_STATUS[e.status]||'scheduled'), category:(e.category==='ratslab'?'ratslab':'foundation') };
    });
    pourById={}; pours.forEach(p=>pourById[p.id]=p);
    // re-resolve membership against current pours (drop orphans whose pour vanished)
    if(footings) footings.forEach(f=>{ if(f.pourId==null) return; if(!pourById[f.pourId]){ f.pourId=null; f.seq=null; } else { f.seq=pourById[f.pourId].seq; } });
  }
  function pourBox(pid){
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9,n=0;
    for(const f of footings){ if(f.pourId!==pid) continue; n++;
      x0=Math.min(x0,f.cx-f.w/2); y0=Math.min(y0,f.cy-f.h/2);
      x1=Math.max(x1,f.cx+f.w/2); y1=Math.max(y1,f.cy+f.h/2); }
    if(!n) return null; const pad=14; return {x:x0-pad,y:y0-pad,w:(x1-x0)+pad*2,h:(y1-y0)+pad*2};
  }
  function pourHull(pid){
    const m=members(pid); if(!m.length) return null;
    if(m.length<3){ const b=pourBox(pid); return [[b.x,b.y],[b.x+b.w,b.y],[b.x+b.w,b.y+b.h],[b.x,b.y+b.h]]; }
    return convex(m.map(f=>[f.cx,f.cy]),20);
  }
  function members(pid){ return footings.filter(f=>f.pourId===pid && !f.del); }
  function pourCY(pid){ return members(pid).reduce((s,f)=>s+f.cyv,0); }
  // Build a Pour-Day footing-map object (its schema: {viewBox, gridCols:[{x,label}], gridRows:[{y,label}],
  // footings:[{id,x,y,w,h,cy,type,ftype}]}) from this pour's assigned footings + the gridlines that frame them.
  function buildPourDayMap(pid){
    if(!footings) return null;
    const mem=members(pid); if(!mem.length) return null;
    // bbox of this pour in foundation coords
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    mem.forEach(f=>{ x0=Math.min(x0,f.cx-f.w/2); y0=Math.min(y0,f.cy-f.h/2); x1=Math.max(x1,f.cx+f.w/2); y1=Math.max(y1,f.cy+f.h/2);
      if(f.isBeam&&f.beam){ x0=Math.min(x0,f.beam.x1,f.beam.x2); x1=Math.max(x1,f.beam.x1,f.beam.x2); y0=Math.min(y0,f.beam.y1,f.beam.y2); y1=Math.max(y1,f.beam.y1,f.beam.y2); } });
    // Fit + center the pour into the Pour-Day canvas (standard 1200×500, like the legacy maps),
    // so each pour fills its own map instead of sitting tiny in absolute plan coords.
    const TW=1200, TH=500, MARGIN=46;
    const bw=Math.max(1,x1-x0), bh=Math.max(1,y1-y0);
    const s=Math.min((TW-MARGIN*2)/bw, (TH-MARGIN*2)/bh);
    const offX=(TW-bw*s)/2, offY=(TH-bh*s)/2;
    const TX=(wx)=>Math.round((wx-x0)*s+offX), TY=(wy)=>Math.round((wy-y0)*s+offY), SC=(v)=>Math.max(6,Math.round(v*s));
    const fam=(t)=>{ t=String(t).toUpperCase(); if(t.indexOf('GB')===0)return 'gb'; if(t.indexOf('PC')===0||t.indexOf('MPC')===0)return 'pc'; return 'ftg'; };
    const fts=mem.map(f=>{
      if(f.isBeam && f.beam){ const b=f.beam, bwid=Math.max(5,f.w*0.78);
        const minx=Math.min(b.x1,b.x2),maxx=Math.max(b.x1,b.x2),miny=Math.min(b.y1,b.y2),maxy=Math.max(b.y1,b.y2);
        const wx=b.horizontal?minx:(f.cx-bwid/2), wy=b.horizontal?(f.cy-bwid/2):miny;
        const ww=b.horizontal?(maxx-minx):bwid, wh=b.horizontal?bwid:(maxy-miny);
        return { id:'fnd'+f.no, x:TX(wx), y:TY(wy), w:SC(ww), h:SC(wh), cy:+f.cyv, type:'gb', ftype:f.type }; }
      return { id:'fnd'+f.no, x:TX(f.cx-f.w/2), y:TY(f.cy-f.h/2), w:SC(f.w), h:SC(f.h), cy:+f.cyv, type:fam(f.type), ftype:f.type };
    });
    const gc=(gridCols||[]).filter(c=>c.x>=x0-bw*0.06 && c.x<=x1+bw*0.06).map(c=>({x:TX(c.x), label:String(c.l)}));
    const gr=(gridRows||[]).filter(c=>c.y>=y0-bh*0.06 && c.y<=y1+bh*0.06).map(c=>({y:TY(c.y), label:String(c.l)}));
    return { viewBox:'0 0 '+TW+' '+TH, gridCols:gc, gridRows:gr, footings:fts, fromFoundation:true };
  }

  // ───────── coords / hit-testing ─────────
  function w2s(x,y){ return [x*scale+tx, y*scale+ty]; }
  function s2w(x,y){ return [(x-tx)/scale, (y-ty)/scale]; }
  function evPos(e){ const r=canvas.getBoundingClientRect(); return [e.clientX-r.left, e.clientY-r.top]; }
  const isDone=(f)=>_footStatus['fnd'+f.no]==='DONE';
  function hitFoot(wx,wy,padPx){
    const pad=(padPx||4)/scale;
    const fComplete=f=>st.hideComplete && f.pourId && pourById[f.pourId] && pourById[f.pourId].status==='complete';   // hidden → not pickable
    for(let i=footings.length-1;i>=0;i--){ const f=footings[i]; if(f.isBeam||f.del||fComplete(f)) continue;
      if(wx>=f.cx-f.w/2-pad&&wx<=f.cx+f.w/2+pad&&wy>=f.cy-f.h/2-pad&&wy<=f.cy+f.h/2+pad) return f; }
    for(let i=footings.length-1;i>=0;i--){ const f=footings[i]; if(!f.isBeam||!f.beam||f.del||fComplete(f)) continue;
      const b=f.beam, bw=Math.max(5,f.w*0.78)/2+pad;
      if(b.horizontal){ if(wx>=Math.min(b.x1,b.x2)-pad&&wx<=Math.max(b.x1,b.x2)+pad&&Math.abs(wy-f.cy)<=bw) return f; }
      else { if(wy>=Math.min(b.y1,b.y2)-pad&&wy<=Math.max(b.y1,b.y2)+pad&&Math.abs(wx-f.cx)<=bw) return f; }
    }
    return null;
  }
  function hitPour(wx,wy){ for(const p of pours){ if(st.hideComplete && p.status==='complete') continue; const b=pourBox(p.id); if(!b) continue; if(wx>=b.x&&wx<=b.x+b.w&&wy>=b.y&&wy<=b.y+b.h) return p; } return null; }

  // ══════════════════════════════════════════════════════════════════════════
  // SEQUENCE LAYER — phase zones, crew routes, date-driven playback
  // --------------------------------------------------------------------------
  // Reproduces (and animates) the hand-drawn sequencing map: labeled phase
  // polygons, five dated activities per phase, and one arrow route per crew/rig.
  // Polygons are stored NORMALIZED ([u,v] in 0..1 of planW/planH) so a change to
  // the geo pad can never silently shift every zone ever drawn.
  // ══════════════════════════════════════════════════════════════════════════
  const SEQ_ACTS = [
    { key:'acp',      label:'ACPs Begin',        short:'ACP',      color:'#f97316' },   // Malcolm ACP rig  (orange)
    { key:'shoring',  label:'Shoring Begins',    short:'Shoring',  color:'#22d3ee' },   // Malcolm shoring  (cyan)
    { key:'excavate', label:'Excavation Begins', short:'Excavate', color:'#ef4444' },   // Zarp excavation  (red)
    { key:'pour',     label:'Pour Foundations',  short:'Pour',     color:'#38bdf8' },
    { key:'backfill', label:'Backfill Complete', short:'Backfill', color:'#a78bfa' },
  ];
  const SEQ_ACT_BY = {}; SEQ_ACTS.forEach((a,i)=>{ SEQ_ACT_BY[a.key]=Object.assign({idx:i}, a); });
  // Zone fill palette — the template's colored areas. Keys are stored on the phase.
  const SEQ_GROUPS = { blue:'#4A8EFF', green:'#41A447', amber:'#FFBF00', violet:'#8B5CF6', teal:'#2dd4bf', rose:'#f472b6', slate:'#94a3b8' };
  const SEQ_POURED='#34d399', SEQ_BEHIND='#fbbf24', SEQ_AHEAD='#38bdf8', SEQ_IDLE='#64748b';

  let _seq=null, _seqDay=null, _seqLayer='all', _seqMode='plan', _seqFilter='ALL';   // _seqFilter: 'ALL' | letter | phaseId — isolate one sequence
  let _seqRev=0, _seqGeomCache=null, _seqPhaseCache=null, _seqSweepCache=null, _seqFootPhase=null;
  let _seqCb=null, _seqCbTimer=0, _seqCbLabel='', _seqZoneCb=null, _seqSelCb=null, _seqNoticeCb=null;
  let _seqPlaying=false, _seqRaf=0, _seqLastT=0, _seqSpeed=3;        // days per second
  let _seqStamp=false, _seqStampTitle='';                            // on-canvas date/progress badge (for video export)
  let _seqShowLabels=true;                                           // phase label circles on/off
  let _seqShowIcons=true;                                            // equipment icons on crew tokens
  let _seqSelId=null, _seqDraft=null, _seqDrag=null, _seqClick=false, _seqRouteCrew=null;
  // Polyline-style vertex editing (Bluebeam habits): ⇧+click a vertex removes it,
  // ⌃/⌘+click an edge inserts one. _seqHover carries what the cursor is over so the
  // canvas can preview the action before the click lands.
  let _seqHover=null, _seqMods={shift:false,add:false}, _seqLastW=null, _seqDownMod=false;
  const _seqIconCache={};                                            // name -> compiled Path2D set

  const seqOn=()=>!!(_seq && _seq.phases && Object.keys(_seq.phases).length);
  // day numbers (UTC, DST-proof) keep every comparison an integer compare
  function _sdNum(iso){ const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||'')); return m?Math.floor(Date.UTC(+m[1],+m[2]-1,+m[3])/86400000):null; }
  function _sdIso(n){ if(n==null) return ''; const d=new Date(n*86400000); return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0'); }
  function planSize(){ return { planW, planH }; }
  function normToWorld(p){ return [p[0]*planW, p[1]*planH]; }
  function worldToNorm(p){ return [planW?p[0]/planW:0, planH?p[1]/planH:0]; }
  function footPt(f){ return (f.isBeam&&f.beam) ? [(f.beam.x1+f.beam.x2)/2,(f.beam.y1+f.beam.y2)/2] : [f.cx,f.cy]; }
  function ptInPoly(x,y,pts){ let inside=false;
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){ const xi=pts[i][0],yi=pts[i][1],xj=pts[j][0],yj=pts[j][1];
      if(((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/((yj-yi)||1e-9)+xi)) inside=!inside; }
    return inside; }
  function seqInvalidate(id){ _seqRev++; _seqFootPhase=null;
    if(id){ if(_seqGeomCache) delete _seqGeomCache[id]; if(_seqPhaseCache) delete _seqPhaseCache[id]; if(_seqSweepCache) delete _seqSweepCache[id]; }
    else { _seqGeomCache=null; _seqPhaseCache=null; _seqSweepCache=null; } }

  function seqPhases(){ if(!seqOn()) return [];
    return Object.keys(_seq.phases).map(k=>_seq.phases[k]).filter(Boolean)
      .sort((a,b)=>((a.order||0)-(b.order||0)) || String(a.label||'').localeCompare(String(b.label||''))); }
  function seqCrews(){ if(!_seq||!_seq.crews) return [];
    return Object.keys(_seq.crews).map(k=>_seq.crews[k]).filter(Boolean).sort((a,b)=>(a.order||0)-(b.order||0)); }

  // world-space geometry for a phase, memoized on the polygon array identity
  function seqGeom(ph){
    if(!_seqGeomCache) _seqGeomCache={};
    const hit=_seqGeomCache[ph.id];
    if(hit && hit._poly===ph.poly && hit._pin===ph.pin && hit._pw===planW) return hit;
    const pts=(ph.poly||[]).map(normToWorld);
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9,cx=0,cy=0;
    pts.forEach(p=>{ x0=Math.min(x0,p[0]); y0=Math.min(y0,p[1]); x1=Math.max(x1,p[0]); y1=Math.max(y1,p[1]); cx+=p[0]; cy+=p[1]; });
    if(!pts.length){ x0=y0=x1=y1=0; } else { cx/=pts.length; cy/=pts.length; }
    const g={ _poly:ph.poly, _pin:ph.pin, _pw:planW, pts, bbox:{x0,y0,x1,y1}, c:[cx,cy], pin: ph.pin?normToWorld(ph.pin):[cx,cy] };
    _seqGeomCache[ph.id]=g; return g;
  }

  // ── footing ↔ phase binding: this is what makes the footings "develop" ──
  // Point-in-polygon on the footing centroid (grade beams by span midpoint — the
  // same rule the lasso select uses), so a phase gets its count + CY for free.
  function phaseFootings(id){
    const ph=seqOn()?_seq.phases[id]:null;
    if(!ph||!footings) return { nos:[], count:0, cy:0 };
    if(!_seqPhaseCache) _seqPhaseCache={};
    const hit=_seqPhaseCache[id];
    if(hit && hit._poly===ph.poly && hit._n===footings.length) return hit;
    const g=seqGeom(ph), nos=[]; let cy=0;
    if(g.pts.length>=3) footings.forEach(f=>{ if(f.del) return;
      const p=footPt(f);
      if(p[0]<g.bbox.x0||p[0]>g.bbox.x1||p[1]<g.bbox.y0||p[1]>g.bbox.y1) return;   // cheap bbox reject first
      if(ptInPoly(p[0],p[1],g.pts)){ nos.push(f.no); cy+=f.cyv||0; } });
    const out={ nos, count:nos.length, cy, _poly:ph.poly, _n:footings.length };
    _seqPhaseCache[id]=out; return out;
  }
  function seqFootPhaseMap(){
    if(_seqFootPhase && _seqFootPhase.rev===_seqRev && _seqFootPhase.n===(footings?footings.length:0)) return _seqFootPhase.m;
    const m={}; seqPhases().forEach(ph=>{ phaseFootings(ph.id).nos.forEach(no=>{ m[no]=ph.id; }); });
    _seqFootPhase={ rev:_seqRev, n:(footings?footings.length:0), m }; return m;
  }
  // Sweep order: footings pour in the direction the crew arrives from, so a pour
  // visibly marches across its zone instead of snapping on all at once.
  function seqPrevInRoute(pid, actKey){
    for(const c of seqCrews()){ if(actKey && c.activity!==actKey) continue;
      const i=(c.route||[]).indexOf(pid); if(i>0) return c.route[i-1]; }
    return null;
  }
  function phaseSweep(pid){
    if(!_seqSweepCache) _seqSweepCache={};
    const hit=_seqSweepCache[pid]; if(hit && hit.rev===_seqRev) return hit.m;
    const ph=_seq.phases[pid], g=seqGeom(ph), fl=phaseFootings(pid);
    let ax=1, ay=0;
    const prev=seqPrevInRoute(pid,'pour');
    if(prev && _seq.phases[prev]){ const pg=seqGeom(_seq.phases[prev]); ax=g.c[0]-pg.c[0]; ay=g.c[1]-pg.c[1]; }
    else if((g.bbox.y1-g.bbox.y0) > (g.bbox.x1-g.bbox.x0)){ ax=0; ay=1; }
    const L=Math.hypot(ax,ay)||1; ax/=L; ay/=L;
    const proj=fl.nos.map(no=>{ const f=byNo[no]; const p=f?footPt(f):[0,0]; return { no, t:p[0]*ax+p[1]*ay }; }).sort((a,b)=>a.t-b.t);
    const m={}, den=Math.max(1, proj.length-1);
    proj.forEach((o,i)=>{ m[o.no] = proj.length>1 ? i/den : 0; });
    _seqSweepCache[pid]={ rev:_seqRev, m }; return m;
  }

  // ── time ──
  function actWin(ph,key){ const a=ph && ph.acts && ph.acts[key]; if(!a) return null;
    const s=_sdNum(a.start); if(s==null) return null; const e=_sdNum(a.end);
    return { s, e:(e!=null&&e>=s)?e:s }; }
  function seqRange(){
    let lo=null, hi=null;
    seqPhases().forEach(ph=>SEQ_ACTS.forEach(a=>{ const w=actWin(ph,a.key); if(!w) return;
      if(lo==null||w.s<lo) lo=w.s; if(hi==null||w.e>hi) hi=w.e; }));
    return { min:lo, max:hi, minIso:_sdIso(lo), maxIso:_sdIso(hi), days:(lo!=null&&hi!=null)?(hi-lo+1):0 };
  }
  // Most advanced activity a phase has reached at day d (activities are ordered).
  function phaseStateAt(ph,d){
    let top=null, active=null;
    for(const a of SEQ_ACTS){ const w=actWin(ph,a.key); if(!w) continue;
      if(d>w.e){ top=a.key; continue; }
      if(d>=w.s){ active={ key:a.key, w, p:(w.e>w.s)?(d-w.s)/(w.e-w.s):1 }; top=a.key; }
      break;
    }
    return { top, active };
  }
  function seqFootPlanned(f){
    if(!seqOn()||_seqDay==null) return false;
    const pid=seqFootPhaseMap()[f.no]; if(!pid) return false;
    const w=actWin(_seq.phases[pid],'pour'); if(!w) return false;
    if(_seqDay>w.e) return true;
    if(_seqDay<w.s) return false;
    const frac=(w.e>w.s)?(_seqDay-w.s)/(w.e-w.s):1;
    const rank=phaseSweep(pid)[f.no];
    return rank!=null && rank<=frac;
  }
  // Area color for a footing (its phase's group) — cached with the phase map.
  function seqGroupColOfPhase(pid){ const ph=pid&&_seq.phases[pid]; return ph ? (ph.color||SEQ_GROUPS[ph.group]||SEQ_GROUPS.slate) : null; }
  function _seqFootGroupCol(f){ return seqGroupColOfPhase(seqFootPhaseMap()[f.no]); }
  // Calm, area-based footing paint. A zone visibly "fills in" with its OWN color as
  // it pours (matches the reference's color-coded areas); un-poured footings sit as a
  // faint tint so zones + arrows stay the primary read. Amber/blue survive only as a
  // thin ring in Both mode (behind / ahead of plan) instead of loud fills.
  function seqFootPaint(f, done){
    if(!seqOn()) return null;
    const g=_seqFootGroupCol(f) || SEQ_IDLE;
    if(_seqFilter!=='ALL' && !seqFootMatchesFilter(f)) return { col:g, a:0.045 };   // isolated: footings outside the picked sequence fade back
    if(_seqDay==null) return null;
    const plan=seqFootPlanned(f);
    if(_seqMode==='actual') return done ? { col:SEQ_POURED, a:0.9 } : { col:g, a:0.13 };
    if(_seqMode==='plan')   return plan ? { col:g, a:0.8 }          : { col:g, a:0.12 };
    // both
    if(plan && done)  return { col:SEQ_POURED, a:0.9 };
    if(plan && !done) return { col:g, a:0.62, ring:'#f59e0b', ringA:0.5 };
    if(!plan && done) return { col:SEQ_POURED, a:0.82, ring:'#38bdf8', ringA:0.5 };
    return { col:g, a:0.12 };
  }

  // ── crew position along its route ──
  function crewLegs(c){
    const r=(c && c.route)||[], out=[];
    for(let i=0;i<r.length-1;i++){ const A=_seq.phases[r[i]], B=_seq.phases[r[i+1]]; if(!A||!B) continue;
      const wa=actWin(A,c.activity), wb=actWin(B,c.activity);
      out.push({ i, from:r[i], to:r[i+1], t0:wa?wa.e:null, t1:wb?wb.s:null }); }
    return out;
  }
  function crewAt(c,d){
    const r=(c && c.route)||[]; if(!r.length||d==null) return null;
    for(let i=0;i<r.length;i++){ const ph=_seq.phases[r[i]]; if(!ph) continue;
      const w=actWin(ph,c.activity); if(!w) continue;
      if(d>=w.s && d<=w.e) return { mode:'work', phase:r[i], leg:i, p:(w.e>w.s)?(d-w.s)/(w.e-w.s):1 };
    }
    const legs=crewLegs(c);
    for(const g of legs){ if(g.t0==null||g.t1==null) continue;
      if(d>g.t0 && d<g.t1) return { mode:'travel', from:g.from, to:g.to, leg:g.i, p:(g.t1>g.t0)?(d-g.t0)/(g.t1-g.t0):1 }; }
    const first=r.find(id=>actWin(_seq.phases[id],c.activity));
    const fw=first?actWin(_seq.phases[first],c.activity):null;
    if(fw && d<fw.s) return { mode:'idle', phase:first, leg:0, p:0 };
    const last=[...r].reverse().find(id=>actWin(_seq.phases[id],c.activity));
    return last ? { mode:'done', phase:last, leg:r.length-1, p:1 } : null;
  }

  // ── geometry for the arrows: bow each leg so routes don't pile up ──
  function legCtrl(a,b,k){
    const dx=b[0]-a[0], dy=b[1]-a[1], L=Math.hypot(dx,dy)||1;
    const bow=Math.min(L*0.24, 140) * ((k%2)?-1:1);
    return [ (a[0]+b[0])/2 - dy/L*bow, (a[1]+b[1])/2 + dx/L*bow ];
  }
  function qPoint(a,c,b,t){ const u=1-t;
    return [ u*u*a[0] + 2*u*t*c[0] + t*t*b[0], u*u*a[1] + 2*u*t*c[1] + t*t*b[1] ]; }
  function qTangent(a,c,b,t){ const u=1-t;
    return [ 2*u*(c[0]-a[0]) + 2*t*(b[0]-c[0]), 2*u*(c[1]-a[1]) + 2*t*(b[1]-c[1]) ]; }

  // ── hit-testing (authoring) ──
  // Only the SELECTED phase's vertices are grabbable — otherwise, with 24 zones tiling
  // the plan, a click anywhere lands on some zone's vertex and hijacks the draw/select.
  function seqHitVertex(wx,wy){ const tol=8/scale;
    const ph=_seqSelId?_seq.phases[_seqSelId]:null; if(!ph) return null;
    const g=seqGeom(ph);
    for(let i=0;i<g.pts.length;i++){ if(Math.abs(g.pts[i][0]-wx)<tol && Math.abs(g.pts[i][1]-wy)<tol) return { id:ph.id, i }; }
    return null; }
  function seqHitPin(wx,wy){ const tol=15/scale;
    for(const ph of seqPhases()){ const g=seqGeom(ph); if(Math.hypot(g.pin[0]-wx,g.pin[1]-wy)<tol) return ph.id; }
    return null; }
  function seqHitZone(wx,wy){ const ps=seqPhases();
    for(let i=ps.length-1;i>=0;i--){ const g=seqGeom(ps[i]); if(g.pts.length>=3 && ptInPoly(wx,wy,g.pts)) return ps[i].id; }
    return null; }
  // Closest point on the SELECTED zone's outline — where a ⌃/⌘+click drops a new vertex.
  // Returns the segment index it belongs to, so the point is spliced in the right place.
  function seqHitEdge(wx,wy){ const tol=10/scale;
    const ph=_seqSelId?_seq.phases[_seqSelId]:null; if(!ph) return null;
    const g=seqGeom(ph), n=g.pts.length; if(n<2) return null;
    let best=null;
    for(let i=0;i<n;i++){
      const a=g.pts[i], b=g.pts[(i+1)%n];
      const dx=b[0]-a[0], dy=b[1]-a[1], L2=dx*dx+dy*dy; if(!L2) continue;
      let t=((wx-a[0])*dx+(wy-a[1])*dy)/L2; t=Math.max(0,Math.min(1,t));
      const px=a[0]+dx*t, py=a[1]+dy*t, d=Math.hypot(px-wx,py-wy);
      if(d<tol && (!best || d<best.d)) best={ id:ph.id, i, at:[px,py], d };
    }
    return best; }
  // Nearest point of the in-progress draft polygon (⇧+click drops it while drawing)
  function seqHitDraftPt(wx,wy){ const tol=10/scale;
    if(!_seqDraft || !_seqDraft.pts.length) return -1;
    let bi=-1, bd=tol;
    _seqDraft.pts.forEach((p,i)=>{ const d=Math.hypot(p[0]-wx,p[1]-wy); if(d<bd){ bd=d; bi=i; } });
    return bi; }

  // ── add / remove a vertex on the selected zone ──
  // Min 3 points: a zone that can't be filled isn't a zone.
  function seqRemoveVertex(id,i){
    const ph=_seq && _seq.phases && _seq.phases[id]; if(!ph) return false;
    const poly=(ph.poly||[]).slice();
    if(poly.length<=3 || i<0 || i>=poly.length) return false;
    poly.splice(i,1); ph.poly=poly;
    seqInvalidate(ph.id); _seqHover=null; scheduleDraw(); fireSeqChange('remove point');
    return true;
  }
  function seqInsertVertex(id,i,worldPt){
    const ph=_seq && _seq.phases && _seq.phases[id]; if(!ph) return -1;
    const poly=(ph.poly||[]).slice(); if(!poly.length) return -1;
    const at=(i+1)%(poly.length+1);                       // land after the segment's start vertex
    poly.splice(at,0,worldToNorm(worldPt)); ph.poly=poly;
    seqInvalidate(ph.id); _seqHover=null; scheduleDraw(); fireSeqChange('add point');
    return at;
  }

  function seqOnDown(wx,wy,e){
    const t=st.seqTool;
    const shift=!!(e&&e.shiftKey), add=!!(e&&(e.ctrlKey||e.metaKey));   // macOS ⌃+click still reports ctrlKey, whichever button it maps to
    if(t==='zone'){
      if(shift){ const i=seqHitDraftPt(wx,wy);                                      // ⇧+click drops a point off the polyline being drawn
        if(i>=0){ _seqDraft.pts.splice(i,1); if(!_seqDraft.pts.length) _seqDraft=null; scheduleDraw(); _seqClick=true; _moved=true; return true; } }
      _seqClick=true; _moved=false; return true;                                    // pure add-vertex on pointer-up; editing is the Move tool
    }
    if(t==='pin'){
      if(shift){                                                                    // ⇧+click a vertex = delete it
        const v=seqHitVertex(wx,wy);
        if(v){ if(!seqRemoveVertex(v.id,v.i)) seqNotice('A zone needs at least 3 points','warn');
          _seqClick=true; _moved=true; return true; }
      }
      if(add && !seqHitVertex(wx,wy)){                                              // ⌃/⌘+click an edge = insert a point there, then drag it
        const eh=seqHitEdge(wx,wy);                                                 // (on top of an existing point it just drags that one)
        if(eh){ const at=seqInsertVertex(eh.id,eh.i,eh.at);
          if(at>=0){ _seqDrag={ type:'vertex', id:eh.id, i:at }; _moved=false; return true; } }
      }
      const pid=seqHitPin(wx,wy);
      if(pid){ _seqDrag={ type:'pin', id:pid }; seqSelect(pid); _moved=false; return true; }
      const v=seqHitVertex(wx,wy); if(v){ _seqDrag={ type:'vertex', id:v.id, i:v.i }; _moved=false; return true; }
      _seqDownMod = shift||add;                          // a mis-aimed ⇧/⌃ click must not drop the selection you are editing
      _seqClick=true; _moved=false; return true;
    }
    if(t==='route'){ _seqClick=true; _moved=false; return true; }
    return false;
  }
  function seqOnMove(wx,wy){
    if(_seqDrag){
      const ph=_seq.phases[_seqDrag.id]; if(!ph){ _seqDrag=null; return false; }
      if(_seqDrag.type==='vertex'){ const poly=(ph.poly||[]).slice(); poly[_seqDrag.i]=worldToNorm([wx,wy]); ph.poly=poly; }
      else ph.pin=worldToNorm([wx,wy]);
      seqInvalidate(ph.id); _moved=true; scheduleDraw(); return true;
    }
    if(_seqDraft){ _seqDraft.cursor=[wx,wy]; scheduleDraw(); return true; }
    return false;
  }
  // Hover preview for the vertex tools — runs on every plain move while the Move/edit
  // tool is live, so the ⇧ / ⌃ affordance shows up before the click.
  function seqHoverAt(wx,wy,e){
    if(e) _seqMods={ shift:!!e.shiftKey, add:!!(e.ctrlKey||e.metaKey) };
    if(wx!=null) _seqLastW=[wx,wy]; else if(_seqLastW){ wx=_seqLastW[0]; wy=_seqLastW[1]; } else return null;
    if(st.seqTool!=='pin' || !seqOn() || !_seqSelId){ if(_seqHover){ _seqHover=null; scheduleDraw(); } return null; }
    const shift=_seqMods.shift, add=_seqMods.add;
    let h=null;
    const v=seqHitVertex(wx,wy);
    if(v) h={ kind: shift?'del':'move', id:v.id, i:v.i };
    else if(add){ const eh=seqHitEdge(wx,wy); if(eh) h={ kind:'add', id:eh.id, i:eh.i, at:eh.at }; }
    const same = (!h&&!_seqHover) || (h&&_seqHover&&h.kind===_seqHover.kind&&h.i===_seqHover.i&&h.id===_seqHover.id
      && (!h.at || (_seqHover.at && Math.abs(h.at[0]-_seqHover.at[0])<0.2 && Math.abs(h.at[1]-_seqHover.at[1])<0.2)));
    _seqHover=h; if(!same) scheduleDraw();
    return h;
  }
  function seqOnUp(wx,wy){
    if(_seqDrag){ const moved=_moved; _seqDrag=null; if(moved) fireSeqChange('move point'); return true; }
    if(!_seqClick) return false;
    _seqClick=false; const wasMod=_seqDownMod; _seqDownMod=false; if(_moved) return true;
    const t=st.seqTool;
    if(t==='pin' && wasMod) return true;                 // missed the point/edge — leave the selection alone
    if(t==='zone'){ if(!_seqDraft) _seqDraft={ pts:[] }; _seqDraft.pts.push([wx,wy]); scheduleDraw(); return true; }
    if(t==='route'){ const pid=seqHitPin(wx,wy)||seqHitZone(wx,wy); if(pid) seqRouteClick(pid); return true; }
    if(t==='pin'){ seqSelect(seqHitZone(wx,wy)); return true; }
    return false;
  }
  function seqRouteClick(pid){
    const c=_seq && _seq.crews && _seq.crews[_seqRouteCrew]; if(!c) return;
    c.route=(c.route||[]).slice();
    if(c.route[c.route.length-1]===pid) c.route.pop(); else c.route.push(pid);
    fireSeqChange(); scheduleDraw();
  }
  function finishSeqDraft(){
    const d=_seqDraft; _seqDraft=null;
    if(!d || d.pts.length<3){ scheduleDraw(); return null; }
    const poly=d.pts.map(worldToNorm);
    scheduleDraw();
    if(_seqZoneCb){ try{ _seqZoneCb(poly); }catch(e){ console.error('seq zone', e); } }
    return poly;
  }
  function cancelSeqDraft(){ _seqDraft=null; scheduleDraw(); }
  function undoSeqDraftPoint(){ if(_seqDraft && _seqDraft.pts.length){ _seqDraft.pts.pop(); if(!_seqDraft.pts.length) _seqDraft=null; scheduleDraw(); } }

  // ── polyline handles on the selected zone (Bluebeam-style) ──
  // Solid squares = real vertices you can drag or ⇧+click away. Hollow midpoint dots
  // = where a ⌃/⌘+click would splice in a new point. Hover paints the live preview.
  function drawZoneHandles(g,sc){
    const n=g.pts.length; if(!n) return;
    const hv=_seqHover;
    if(_seqMods.add){                                                     // midpoint "add here" ghosts, only while ⌃/⌘ is down
      ctx.lineWidth=1.2/sc; ctx.strokeStyle='rgba(126,231,135,0.75)'; ctx.fillStyle='rgba(6,6,14,0.85)';
      for(let i=0;i<n;i++){ const a=g.pts[i], b=g.pts[(i+1)%n];
        const mx=(a[0]+b[0])/2, my=(a[1]+b[1])/2;
        ctx.beginPath(); ctx.arc(mx,my,2.6/sc,0,7); ctx.fill(); ctx.stroke(); }
    }
    const hs=3.4/sc; ctx.lineWidth=1.5/sc;
    g.pts.forEach((p,i)=>{
      const del = hv && hv.kind==='del' && hv.i===i;
      ctx.fillStyle = del?'rgba(255,107,107,0.95)':'#06060e';
      ctx.strokeStyle = del?'#ff6b6b':'#52E6E0';
      ctx.beginPath(); ctx.rect(p[0]-hs,p[1]-hs,hs*2,hs*2); ctx.fill(); ctx.stroke();
      if(del){                                                            // × over the point that ⇧+click will drop
        const r=6.5/sc; ctx.strokeStyle='#ff6b6b'; ctx.lineWidth=1.8/sc;
        ctx.beginPath(); ctx.moveTo(p[0]-r,p[1]-r); ctx.lineTo(p[0]+r,p[1]+r);
        ctx.moveTo(p[0]+r,p[1]-r); ctx.lineTo(p[0]-r,p[1]+r); ctx.stroke();
        ctx.beginPath(); ctx.arc(p[0],p[1],r+2/sc,0,7); ctx.lineWidth=1.1/sc; ctx.stroke();
      }
    });
    if(hv && hv.kind==='add' && hv.at){                                   // + at the exact spot the new point lands
      const p=hv.at, r=6.5/sc;
      ctx.fillStyle='rgba(126,231,135,0.95)'; ctx.strokeStyle='#7ee787'; ctx.lineWidth=1.6/sc;
      ctx.beginPath(); ctx.arc(p[0],p[1],3.6/sc,0,7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(p[0]-r,p[1]); ctx.lineTo(p[0]+r,p[1]);
      ctx.moveTo(p[0],p[1]-r); ctx.lineTo(p[0],p[1]+r); ctx.stroke();
      ctx.beginPath(); ctx.arc(p[0],p[1],r+2/sc,0,7); ctx.lineWidth=1.1/sc; ctx.stroke();
    }
  }

  // ── rendering: zones sit UNDER the footings so the footings stay legible ──
  function drawSeqZones(vx0,vy0,vx1,vy1,sc){
    if(!seqOn()) return;
    const pulse=0.5+0.5*Math.sin(performance.now()/380);
    seqPhases().forEach(ph=>{
      const g=seqGeom(ph); if(g.pts.length<3) return;
      if(g.bbox.x0>vx1||g.bbox.y0>vy1||g.bbox.x1<vx0||g.bbox.y1<vy0) return;
      const s2=phaseStateAt(ph,_seqDay);
      const off = (_seqLayer!=='all' && !actWin(ph,_seqLayer)) || !seqPhaseMatchesFilter(ph);   // not in the shown layer, or filtered out by sequence
      // STABLE area color (never the activity color) — the reference keeps each area one
      // hue. State reads through opacity + a soft glow only, so the map never goes mono-red.
      const col = ph.color || SEQ_GROUPS[ph.group] || SEQ_GROUPS.slate;
      const started = !!s2.top || !!s2.active;
      let a = s2.active ? 0.14+0.05*pulse : (s2.top ? 0.10 : 0.055);
      if(off) a*=0.3;
      ctx.beginPath(); g.pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath();
      if(s2.active){ ctx.save(); ctx.shadowColor=hex2rgba(col,0.5); ctx.shadowBlur=18; }   // gentle glow on the zone in progress
      ctx.fillStyle=hex2rgba(col,a); ctx.fill();
      if(s2.active) ctx.restore();
      const isSel=_seqSelId===ph.id;
      ctx.lineWidth=(isSel?2.6:1.1)/sc;
      ctx.strokeStyle=hex2rgba(isSel?'#52E6E0':col, off?0.14:(s2.active?0.7:(started?0.34:0.2)));
      ctx.stroke();
      if(st.seqTool==='pin' && isSel) drawZoneHandles(g,sc);   // vertex + midpoint handles — ONLY the selected zone
    });
    if(_seqDraft && _seqDraft.pts.length){
      ctx.strokeStyle='#52E6E0'; ctx.lineWidth=2/sc; ctx.setLineDash([7/sc,5/sc]); ctx.lineJoin='round';
      ctx.beginPath(); _seqDraft.pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
      if(_seqDraft.cursor) ctx.lineTo(_seqDraft.cursor[0],_seqDraft.cursor[1]);
      if(_seqDraft.pts.length>2) ctx.lineTo(_seqDraft.pts[0][0],_seqDraft.pts[0][1]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle='#52E6E0'; _seqDraft.pts.forEach(p=>{ ctx.beginPath(); ctx.arc(p[0],p[1],3.2/sc,0,7); ctx.fill(); });
    }
  }
  // arrows + crew tokens, drawn OVER the footings (world space, screen-constant widths)
  function drawSeqRoutes(sc){
    if(!seqOn()) return;
    const now=performance.now();
    seqCrews().forEach(c=>{
      if(_seqLayer!=='all' && c.activity!==_seqLayer) return;
      const col=c.color||'#94a3b8';
      const at=crewAt(c,_seqDay);
      crewLegs(c).forEach(g=>{
        const A=_seq.phases[g.from], B=_seq.phases[g.to]; if(!A||!B) return;
        const a=seqGeom(A).pin, b=seqGeom(B).pin, k=legCtrl(a,b,g.i);
        const cur = at && at.mode==='travel' && at.leg===g.i;
        const past = _seqDay!=null && g.t1!=null && _seqDay>=g.t1;
        ctx.lineCap='round'; ctx.lineJoin='round';
        if(cur){ ctx.save(); ctx.shadowColor=hex2rgba(col,0.6); ctx.shadowBlur=10; }
        ctx.strokeStyle=hex2rgba(col, cur?1:(past?0.5:0.14));   // solid throughout — no dashed spaghetti; future legs whisper
        ctx.lineWidth=(cur?3.2:(past?2.0:1.4))/sc;
        if(cur){ ctx.setLineDash([13/sc,8/sc]); ctx.lineDashOffset=-(now/24)/sc; }   // marching ants on the active leg only
        ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.quadraticCurveTo(k[0],k[1],b[0],b[1]); ctx.stroke();
        ctx.setLineDash([]); ctx.lineDashOffset=0; if(cur) ctx.restore();
        // arrowhead, oriented along the curve's tangent at the target
        const tg=qTangent(a,k,b,0.97), L=Math.hypot(tg[0],tg[1])||1, ux=tg[0]/L, uy=tg[1]/L;
        const tip=qPoint(a,k,b,0.985), hl=(cur?15:11)/sc, hw=(cur?7:5.5)/sc;
        ctx.fillStyle=hex2rgba(col, cur?1:(past?0.55:0.16));
        ctx.beginPath(); ctx.moveTo(tip[0],tip[1]);
        ctx.lineTo(tip[0]-ux*hl-uy*hw, tip[1]-uy*hl+ux*hw);
        ctx.lineTo(tip[0]-ux*hl+uy*hw, tip[1]-uy*hl-ux*hw);
        ctx.closePath(); ctx.fill();
      });
    });
  }
  // crew tokens + phase labels — screen space so they stay readable at any zoom
  function drawSeqChrome(sc){
    if(!seqOn()) return;
    const pulse=0.5+0.5*Math.sin(performance.now()/300);
    // Phases that already have a crew token parked on them get no activity badge —
    // the rig riding the token says it better, and two discs on one pin is clutter.
    const manned=new Set();
    if(_seqShowIcons) seqCrews().forEach(c=>{
      if(_seqLayer!=='all' && c.activity!==_seqLayer) return;
      const at=crewAt(c,_seqDay);
      if(at && at.mode==='work' && at.phase) manned.add(at.phase);
    });
    if(_seqShowLabels) seqPhases().forEach(ph=>{
      const g=seqGeom(ph); if(!g.pts.length) return;
      const sx=g.pin[0]*sc+tx, sy=g.pin[1]*sc+ty;
      if(sx<-90||sy<-40||sx>cssW+90||sy>cssH+40) return;
      const s2=phaseStateAt(ph,_seqDay);
      const off=(_seqLayer!=='all' && !actWin(ph,_seqLayer)) || !seqPhaseMatchesFilter(ph);
      const col=ph.color||SEQ_GROUPS[ph.group]||SEQ_GROUPS.slate;   // explicit per-phase color (letter hue + sub-phase shade), else group palette
      const begun = !!(s2.top || s2.active);
      const done = s2.top==='backfill' || (s2.top==='pour' && !s2.active);
      const sel = _seqSelId===ph.id;
      const label=String(ph.label||'?');
      ctx.font='800 12px Inter, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      const r=Math.max(12, ctx.measureText(label).width/2+8);
      ctx.globalAlpha=off?0.3:1;
      if(s2.active){ ctx.fillStyle=hex2rgba(col,0.18+0.16*pulse); ctx.beginPath(); ctx.arc(sx,sy,r+5+3*pulse,0,7); ctx.fill(); }
      // filled disc in the area color once the phase has started; hollow dark disc before it
      ctx.fillStyle = begun ? hex2rgba(col, done?0.9:0.82) : 'rgba(10,14,20,0.92)';
      ctx.beginPath(); ctx.arc(sx,sy,r,0,7); ctx.fill();
      ctx.strokeStyle=sel?'#52E6E0':hex2rgba(col, begun?1:0.85); ctx.lineWidth=sel?2.6:1.6; ctx.stroke();
      ctx.fillStyle= begun ? '#0b0f16' : (sel?'#9ff2ee':'#e8eefb'); ctx.fillText(label,sx,sy+0.5);
      // A phase that is live right now wears a badge of whatever activity it is in,
      // so you can read "this block is being augered / excavated / poured" at a glance.
      if(_seqShowIcons && s2.active && !off && !manned.has(ph.id)){
        const ik=SEQ_ACT_ICON[s2.active.key], acol=(SEQ_ACT_BY[s2.active.key]||{}).color||col;
        if(ik){
          const bx=sx+r*0.74+3.5, by=sy-r*0.74-3.5;
          ctx.fillStyle='rgba(8,11,18,0.94)'; ctx.beginPath(); ctx.arc(bx,by,9.5,0,7); ctx.fill();
          ctx.strokeStyle=hex2rgba(acol,0.95); ctx.lineWidth=1.4; ctx.stroke();
          drawSeqIcon(ik, bx, by, 13.5, acol);
          ctx.font='800 12px Inter, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        }
      }
      if(sel || st.seqTool==='pin'){                                   // counts on the selected phase only — keeps it clean
        const fl=phaseFootings(ph.id);
        const sub=fl.count+' ftg · '+fmt(fl.cy)+' CY';
        ctx.font='700 10px JetBrains Mono, monospace';
        const tw=ctx.measureText(sub).width;
        ctx.fillStyle='rgba(8,11,18,0.9)'; rrect(ctx,sx-tw/2-6,sy+r+3,tw+12,17,5); ctx.fill();
        ctx.strokeStyle=hex2rgba(col,0.5); ctx.lineWidth=1; ctx.stroke();
        ctx.fillStyle=hex2rgba(col,0.95); ctx.fillText(sub,sx,sy+r+11.5);
      }
      ctx.globalAlpha=1;
    });
    // Only ACTIVE crews get a token — a crew that has finished (or hasn't started)
    // parks on a circle and reads as static clutter, making it look like just one crew
    // moves. Showing only work/travel means every token on screen is a live crew, so
    // whenever crews overlap in time you genuinely see several moving at once.
    seqCrews().forEach(c=>{
      if(_seqLayer!=='all' && c.activity!==_seqLayer) return;
      const at=crewAt(c,_seqDay); if(!at) return;
      if(at.mode!=='work' && at.mode!=='travel') return;
      const col=c.color||'#94a3b8';
      let w;
      if(at.mode==='travel'){ const A=_seq.phases[at.from], B=_seq.phases[at.to]; if(!A||!B) return;
        const a=seqGeom(A).pin, b=seqGeom(B).pin, k=legCtrl(a,b,at.leg);
        const e=at.p<0.5 ? 2*at.p*at.p : 1-Math.pow(-2*at.p+2,2)/2;                       // easeInOutQuad
        w=qPoint(a,k,b,e);
        // motion trail: a short fading tail behind the token so movement is unmistakable
        const seg=12; ctx.lineCap='round';
        for(let s3=0;s3<seg;s3++){ const t0=Math.max(0,e-0.10*(1-s3/seg)), t1=Math.max(0,e-0.10*(1-(s3+1)/seg));
          const p0=qPoint(a,k,b,t0), p1=qPoint(a,k,b,t1);
          ctx.strokeStyle=hex2rgba(col, 0.05+0.30*(s3/seg)); ctx.lineWidth=(2+4*(s3/seg));
          ctx.beginPath(); ctx.moveTo(p0[0]*sc+tx,p0[1]*sc+ty); ctx.lineTo(p1[0]*sc+tx,p1[1]*sc+ty); ctx.stroke(); }
      } else { const P=_seq.phases[at.phase]; if(!P) return; w=seqGeom(P).pin; }
      const sx=w[0]*sc+tx, sy=w[1]*sc+ty;
      if(sx<-40||sy<-40||sx>cssW+40||sy>cssH+40) return;
      const working=at.mode==='work';
      const ico=_seqShowIcons ? seqIconName(c) : null;
      const rr=(ico?14:12) + (working?2.5*pulse:1.5);
      ctx.save(); ctx.shadowColor=hex2rgba(col,0.75); ctx.shadowBlur=working?10+6*pulse:14;
      ctx.fillStyle=hex2rgba(col,0.24+(working?0.2*pulse:0.06)); ctx.beginPath(); ctx.arc(sx,sy,rr+8,0,7); ctx.fill();
      ctx.shadowBlur=working?6:9;
      ctx.fillStyle=hex2rgba(col,0.98); ctx.beginPath(); ctx.arc(sx,sy,rr,0,7); ctx.fill(); ctx.restore();
      ctx.strokeStyle='rgba(8,11,18,0.9)'; ctx.lineWidth=2; ctx.stroke();
      ctx.textAlign='center'; ctx.textBaseline='middle';
      // The rig itself rides the token; the crew tag drops to a small badge so two
      // excavators (Zarp #1 / #2) are still told apart by color + number.
      if(ico && drawSeqIcon(ico, sx, sy, rr*1.6, '#08090f')){
        const tag=crewTag(c);
        ctx.font='800 9px Inter, sans-serif';
        const bw=Math.max(15, ctx.measureText(tag).width+9), bx=sx+rr-1, by=sy+rr-2;
        ctx.fillStyle='rgba(8,11,18,0.92)'; rrect(ctx,bx-bw/2,by-6.5,bw,13,6.5); ctx.fill();
        ctx.strokeStyle=hex2rgba(col,0.9); ctx.lineWidth=1.1; ctx.stroke();
        ctx.fillStyle=hex2rgba(col,1); ctx.fillText(tag,bx,by+0.5);
      } else {
        ctx.fillStyle='#08090f'; ctx.font='800 11px Inter, sans-serif';
        ctx.fillText(crewTag(c), sx, sy+0.5);
      }
      // Short crew name under the token — so a captured video says WHO is moving.
      if(_seqShowIcons){
        const nm=String(c.name||'').replace(/\s*(Crew|Rig)\s*/gi,' ').trim();
        if(nm){
          ctx.font='700 9.5px Inter, sans-serif';
          const tw=ctx.measureText(nm).width;
          ctx.fillStyle='rgba(6,9,16,0.72)'; rrect(ctx,sx-tw/2-5,sy+rr+4,tw+10,14,7); ctx.fill();
          ctx.fillStyle=hex2rgba(col,0.95); ctx.fillText(nm, sx, sy+rr+11.4);
        }
      }
    });
    ctx.textAlign='left';
    if(_seqStamp) drawSeqStamp();
  }
  // Self-contained date + progress badge burned onto the canvas — so a captured
  // video (canvas stream) carries the readout even though the HTML HUD does not.
  const _SD_MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function _seqStampDate(){ if(_seqDay==null) return '—'; const d=new Date(Math.round(_seqDay)*86400000);
    return _SD_MON[d.getUTCMonth()]+' '+d.getUTCDate()+', '+d.getUTCFullYear(); }
  function drawSeqStamp(){
    if(!seqOn()) return;
    let planned=0,total=0; footings.forEach(f=>{ if(f.del)return; total++; if(seqFootPlanned(f))planned++; });
    const w=Math.min(340, cssW-32), h=66, x=18, y=cssH-18-h;
    ctx.save();
    ctx.fillStyle='rgba(6,8,14,0.84)'; rrect(ctx,x,y,w,h,11); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=1; ctx.stroke();
    ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    if(_seqStampTitle){ ctx.fillStyle='rgba(150,168,196,0.85)'; ctx.font='700 10px Inter, sans-serif';
      ctx.fillText(String(_seqStampTitle).toUpperCase().slice(0,42), x+15, y+19); }
    ctx.fillStyle='#eaf1fb'; ctx.font='800 22px "JetBrains Mono", monospace'; ctx.fillText(_seqStampDate(), x+15, y+43);
    const bx=x+15, by=y+h-13, bw=w-30, frac=total?planned/total:0;
    ctx.fillStyle='rgba(255,255,255,0.09)'; rrect(ctx,bx,by,bw,5,2.5); ctx.fill();
    ctx.fillStyle='#38bdf8'; rrect(ctx,bx,by,Math.max(0,bw*frac),5,2.5); ctx.fill();
    ctx.textAlign='right'; ctx.fillStyle='rgba(180,196,220,0.9)'; ctx.font='700 11px "JetBrains Mono", monospace';
    ctx.fillText(planned+' / '+total+' footings', x+w-15, y+43);
    ctx.textAlign='left'; ctx.restore();
  }
  function setSeqStamp(on, title){ _seqStamp=!!on; if(title!=null) _seqStampTitle=title; scheduleDraw(); }
  function setSeqLabels(on){ _seqShowLabels=!!on; scheduleDraw(); }
  function seqLabelsOn(){ return _seqShowLabels; }
  function setSeqIcons(on){ _seqShowIcons=!!on; scheduleDraw(); }
  function seqIconsOn(){ return _seqShowIcons; }
  // ── equipment icons on the canvas ──
  // Path2D-compiled once per icon, then drawn scaled/centred wherever we need it.
  function seqIconPaths(name){
    let p=_seqIconCache[name];
    if(p!==undefined) return p;
    const ic=SEQ_ICONS[name];
    if(!ic || typeof Path2D==='undefined') return (_seqIconCache[name]=null);
    const fills=(ic.f||[]).map(d=>new Path2D(d));
    (ic.c||[]).forEach(c=>{ const q=new Path2D(); q.arc(c[0],c[1],c[2],0,7); fills.push(q); });
    const strokes=(ic.s||[]).map(s=>[new Path2D(s[0]), s[1]]);
    return (_seqIconCache[name]={ fills, strokes });
  }
  function drawSeqIcon(name, cx, cy, size, color){
    const p=seqIconPaths(name); if(!p) return false;
    const k=size/24;
    ctx.save();
    ctx.translate(cx-size/2, cy-size/2); ctx.scale(k,k);
    ctx.fillStyle=color; p.fills.forEach(f=>ctx.fill(f));
    ctx.strokeStyle=color; ctx.lineCap='round'; ctx.lineJoin='round';
    p.strokes.forEach(s=>{ ctx.lineWidth=s[1]; ctx.stroke(s[0]); });
    ctx.restore();
    return true;
  }
  function crewTag(c){
    const n=String(c.name||'').replace(/[^A-Za-z0-9 #]/g,'').trim();
    const num=/#\s*(\d+)/.exec(n);
    const first=(n.split(/\s+/)[0]||'?').charAt(0).toUpperCase();
    return num ? (first+num[1]) : first;
  }

  // ── playback ──
  function seqPlay(on){
    on=!!on;
    if(on===_seqPlaying) return;
    _seqPlaying=on;
    if(!on){ if(_seqRaf) cancelAnimationFrame(_seqRaf); _seqRaf=0; scheduleDraw(); return; }
    const r=seqRange(); if(r.min==null){ _seqPlaying=false; return; }
    if(_seqDay==null || _seqDay>=r.max) _seqDay=r.min;
    _seqLastT=performance.now();
    const tick=()=>{
      if(!_seqPlaying){ _seqRaf=0; return; }
      const now=performance.now(), dt=Math.min(0.25,(now-_seqLastT)/1000); _seqLastT=now;
      const rr=seqRange();
      _seqDay += dt*_seqSpeed;
      if(rr.max!=null && _seqDay>=rr.max){ _seqDay=rr.max; _seqPlaying=false; }   // stop at the end, don't loop past it
      draw();
      fireSeqTick();
      _seqRaf = _seqPlaying ? requestAnimationFrame(tick) : 0;
    };
    _seqRaf=requestAnimationFrame(tick);
  }
  let _seqTickCb=null;
  function fireSeqTick(){ if(_seqTickCb){ try{ _seqTickCb(_sdIso(Math.round(_seqDay)), _seqPlaying); }catch(e){} } }
  function setSeqSpeed(v){ _seqSpeed=Math.max(0.25, +v||3); }
  function setSeqPlayhead(iso){
    const n=(typeof iso==='number')?iso:_sdNum(iso);
    _seqDay=(n==null)?null:n; scheduleDraw();
  }
  function getSeqPlayhead(){ return _seqDay==null?'':_sdIso(Math.round(_seqDay)); }
  function setSeqLayer(l){ _seqLayer=l||'all'; scheduleDraw(); }
  function setSeqMode(m){ _seqMode=(m==='actual'||m==='both')?m:'plan'; scheduleDraw(); }
  // ── sequence isolation filter: 'ALL' | letter (A..I,0) | a specific phaseId ──
  function seqLetterOf(lbl){ return lbl==='0' ? '0' : String(lbl||'').charAt(0); }
  function setSeqFilter(k){ _seqFilter=k||'ALL'; scheduleDraw(); }
  function getSeqFilter(){ return _seqFilter; }
  function seqLetters(){ const seen=new Set(), out=[]; seqPhases().forEach(ph=>{ const L=seqLetterOf(ph.label); if(!seen.has(L)){ seen.add(L); out.push({ letter:L, color: ph.color || SEQ_GROUPS[ph.group] || SEQ_GROUPS.slate }); } }); return out; }
  function seqPhaseMatchesFilter(ph){ if(_seqFilter==='ALL'||!ph) return true; if(_seqFilter===ph.id) return true; return _seqFilter===seqLetterOf(ph.label); }
  function seqFootMatchesFilter(f){ if(_seqFilter==='ALL') return true; const pid=seqFootPhaseMap()[f.no]; if(!pid) return false; return seqPhaseMatchesFilter(_seq.phases[pid]); }
  function setSeqTool(t){ st.seqTool=t||'none'; if(t!=='zone') _seqDraft=null;
    if(t!=='pin'){ _seqHover=null; _seqMods={shift:false,add:false}; _seqDownMod=false; }
    if(canvas) canvas.style.cursor=(t==='zone'||t==='route')?'crosshair':(t==='pin'?'move':'default');
    scheduleDraw(); }
  function setSeqRouteCrew(id){ _seqRouteCrew=id||null; }
  function getSeqRouteCrew(){ return _seqRouteCrew; }
  function seqSelect(id){ _seqSelId=id||null; scheduleDraw();
    if(_seqSelCb){ try{ _seqSelCb(_seqSelId); }catch(e){} } }
  function getSeqSelected(){ return _seqSelId; }
  function setSequence(seq){
    _seq = seq || null;
    if(_seqSelId && !(seqOn() && _seq.phases[_seqSelId])) _seqSelId=null;
    seqInvalidate();
    if(_seqDay==null){ const r=seqRange(); if(r.min!=null) _seqDay=r.min; }
    scheduleDraw();
  }
  function getSequence(){ return _seq; }
  function onSeqChange(cb){ _seqCb=cb; }
  function onSeqZoneDrawn(cb){ _seqZoneCb=cb; }
  function onSeqSelect(cb){ _seqSelCb=cb; }
  function onSeqTick(cb){ _seqTickCb=cb; }
  function onSeqNotice(cb){ _seqNoticeCb=cb; }
  function seqNotice(msg,kind){ if(_seqNoticeCb){ try{ _seqNoticeCb(msg,kind); }catch(e){} } }
  // `label` names the edit for the host's undo stack ("add point", "move point", …)
  function fireSeqChange(label){ if(!_seqCb) return; clearTimeout(_seqCbTimer);
    _seqCbLabel=label||'map edit';
    _seqCbTimer=setTimeout(()=>{ const l=_seqCbLabel; try{ _seqCb(_seq,l); }catch(e){ console.error('seq change', e); } }, 400); }

  // ── zone sources: from the current multi-selection, or from an existing pour ──
  function bboxPoly(pts,pad){
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    pts.forEach(p=>{ x0=Math.min(x0,p[0]); y0=Math.min(y0,p[1]); x1=Math.max(x1,p[0]); y1=Math.max(y1,p[1]); });
    return [[x0-pad,y0-pad],[x1+pad,y0-pad],[x1+pad,y1+pad],[x0-pad,y1+pad]];
  }
  function hullFromSelection(){
    if(!selFootings||!selFootings.size||!byNo) return null;
    const pts=[...selFootings].map(no=>byNo[no]).filter(f=>f&&!f.del).map(footPt);
    if(!pts.length) return null;
    const h=(pts.length<3)?bboxPoly(pts,26):convex(pts,26);
    return h.map(worldToNorm);
  }
  function pourHullNorm(pid){ const h=pourHull(pid); return h?h.map(worldToNorm):null; }
  function listPours(){ return (pours||[]).map(p=>({ id:p.id, name:p.name, seq:p.seq, color:p.color,
    pour_date:p.pour_date, status:p.status, count:members(p.id).length, cy:pourCY(p.id) })); }

  // Rollup for the app's HUD: planned vs actual at the playhead.
  function getSeqStats(){
    const out={ day:getSeqPlayhead(), total:0, planned:0, actual:0, cyTotal:0, cyPlanned:0, cyActual:0, crews:[], phases:0 };
    if(!footings) return out;
    const on=seqOn();
    footings.forEach(f=>{ if(f.del) return;
      out.total++; out.cyTotal+=f.cyv||0;
      if(isDone(f)){ out.actual++; out.cyActual+=f.cyv||0; }
      if(on && seqFootPlanned(f)){ out.planned++; out.cyPlanned+=f.cyv||0; } });
    if(on){
      out.phases=seqPhases().length;
      out.crews=seqCrews().map(c=>{ const at=crewAt(c,_seqDay);
        const ph=at?(_seq.phases[at.phase]||_seq.phases[at.to]):null;
        return { id:c.id, name:c.name, color:c.color, activity:c.activity, icon:seqIconName(c),
                 mode:at?at.mode:'idle', phase:ph?ph.label:'', p:at?at.p:0 }; });
    }
    return out;
  }
  function seqActs(){ return SEQ_ACTS.map(a=>Object.assign({},a)); }
  function seqGroups(){ return Object.assign({}, SEQ_GROUPS); }

  // ───────── interaction ─────────
  const onWheel=(e)=>{ e.preventDefault();
    // While a mouse button is held (middle-button / Space pan, drag, marquee) the wheel must NOT
    // zoom — that's what caused "random zoom" when holding the wheel down to pan, Bluebeam-style.
    if(pointers.size>0 || _spaceDown || drag || band || _selBand || _markBand || _footDrag) return;
    const [mx,my]=evPos(e);
    // Shift+wheel = horizontal pan, plain wheel = zoom-at-cursor (Bluebeam feel)
    if(e.shiftKey){ tx-=e.deltaY*PAN_SENS; scheduleDraw(); return; }
    zoomAt(mx,my,Math.exp(-e.deltaY*WHEEL_ZOOM)); };
  function zoomAt(mx,my,f){
    const ns=Math.max(base*0.6, Math.min(base*14, scale*f));
    const k=ns/scale; tx=mx-(mx-tx)*k; ty=my-(my-ty)*k;
    scale=ns; updateZoom(); scheduleDraw(); draw();
  }
  function pinchState(){ const pts=[...pointers.values()]; const dx=pts[0].x-pts[1].x, dy=pts[0].y-pts[1].y;
    return {dist:Math.hypot(dx,dy), cx:(pts[0].x+pts[1].x)/2, cy:(pts[0].y+pts[1].y)/2}; }
  const onDown=(e)=>{
    canvas.setPointerCapture?.(e.pointerId);
    const [mx,my]=evPos(e); pointers.set(e.pointerId,{x:mx,y:my});
    if(pointers.size===2){ drag=null; band=null; _markBand=null; _markDrag=null; _selBand=null; _pinch=pinchState(); return; }
    if(e.button===1 || _spaceDown){ drag={mx,my,tx,ty,downx:mx,downy:my,pan:true}; _moved=false; canvas.style.cursor='grabbing'; return; }   // PAN = middle wheel button OR hold Space
    // ── MARK DONE tool: tap toggles a footing complete; drag pans (glove-friendly) ──
    if(st.tool==='markdone'){ drag={mx,my,tx,ty,downx:mx,downy:my,pan:true}; _moved=false; return; }
    const [wx,wy]=s2w(mx,my);
    // ── sequence authoring (draw zone / move pin / build route) — after the pan
    //    checks above, so Space-pan and middle-drag still work while authoring ──
    if(st.seqTool && st.seqTool!=='none'){ if(seqOnDown(wx,wy,e)) return; }
    // ── markup tools ──
    if(st.tool==='region'){ _markBand={x0:wx,y0:wy,x1:wx,y1:wy}; _moved=false; return; }
    if(st.tool==='markselect'){
      // grab a corner handle of the already-selected region to resize the filled area
      const selM = selMarkupId ? markups.find(x=>x.id===selMarkupId) : null;
      if(selM && selM.type==='region'){ const h=regionHandleAt(selM,wx,wy);
        if(h>=0){ pushUndo(); _markResize={id:selM.id,corner:h}; _moved=false; return; } }
      const m=hitMarkup(wx,wy);
      if(m){ pushUndo(); selMarkupId=m.id; _markDrag={id:m.id,wx,wy,orig:m.pts.map(p=>p.slice())}; _moved=false; scheduleDraw(); renderPanel(); }
      else { selMarkupId=null; _moved=false; scheduleDraw(); }
      return;
    }
    if(st.tool==='polyline' || st.tool==='text' || st.tool==='addfoot'){ drag={mx,my,tx,ty,downx:mx,downy:my}; _moved=false; return; }  // click→action on up (no pan)
    // ── MOVE tool (footedit): drag a footing to reposition; empty drag = marquee select ──
    if(st.tool==='footedit'){ const f=hitFoot(wx,wy);
      if(f){ if(tryGroupDrag(f,wx,wy)) return; selectFooting(f.no); _footDrag={no:f.no,dx:wx-f.cx,dy:wy-f.cy,moved:false}; }
      else { selFootingNo=null; renderPanel(); _selBand={x0:wx,y0:wy,x1:wx,y1:wy,add:e.shiftKey}; _moved=false; }
      return;
    }
    // ── ASSIGN tool: paint footings into the selected pour ──
    if(st.mode==='assign' && st.selId && !e.shiftKey){ band={x0:wx,y0:wy,x1:wx,y1:wy}; _moved=false; return; }
    // ── SELECT tool (default): grab a multi-selection to move it, else click to select / drag to marquee ──
    if(tryGroupDrag(hitFoot(wx,wy), wx, wy)) return;
    _selBand={x0:wx,y0:wy,x1:wx,y1:wy,add:e.shiftKey}; _moved=false;
  };
  const onMove=(e)=>{
    const [mx,my]=evPos(e);
    if(pointers.has(e.pointerId)) pointers.set(e.pointerId,{x:mx,y:my});
    if(pointers.size===2 && _pinch){
      const ns=pinchState(); zoomAt(ns.cx,ns.cy, ns.dist/(_pinch.dist||1));
      tx+=ns.cx-_pinch.cx; ty+=ns.cy-_pinch.cy; _pinch=ns; scheduleDraw(); return;
    }
    if((_seqDrag||_seqDraft) && !drag){ const w=s2w(mx,my); if(seqOnMove(w[0],w[1])) return; }
    if(_markBand){ const w=s2w(mx,my); _markBand.x1=w[0]; _markBand.y1=w[1]; _moved=true; scheduleDraw(); return; }
    if(_selBand){ const w=s2w(mx,my); _selBand.x1=w[0]; _selBand.y1=w[1]; _moved=true; scheduleDraw(); return; }
    if(_markResize){ const w=s2w(mx,my); const m=markups.find(x=>x.id===_markResize.id);
      if(m){ resizeRegionCorner(m,_markResize.corner,w[0],w[1]); _moved=true; scheduleDraw(); } return; }
    if(_markDrag){ const w=s2w(mx,my); const dx=w[0]-_markDrag.wx, dy=w[1]-_markDrag.wy; const m=markups.find(x=>x.id===_markDrag.id);
      if(m){ m.pts=_markDrag.orig.map(p=>[p[0]+dx,p[1]+dy]); _moved=true; scheduleDraw(); } return; }
    if(_groupDrag){ const w=s2w(mx,my); const dx=w[0]-_groupDrag.wx, dy=w[1]-_groupDrag.wy;
      if(!_groupDrag.moved){ pushUndo(); _groupDrag.moved=true; }
      Object.keys(_groupDrag.orig).forEach(no=>{ const o=_groupDrag.orig[no]; moveFooting(+no, o.cx+dx, o.cy+dy, false); });
      scheduleDraw(); return; }
    if(_footDrag){ const w=s2w(mx,my); const f=byNo[_footDrag.no]; if(f){ moveFooting(f.no, w[0]-_footDrag.dx, w[1]-_footDrag.dy, !_footDrag.moved); _footDrag.moved=true; scheduleDraw(); } return; }
    if(st.tool==='polyline' && _markDraft && !drag){ _markDraft.cursor=s2w(mx,my); scheduleDraw(); return; }
    if(band){ const w=s2w(mx,my); band.x1=w[0]; band.y1=w[1]; _moved=true; scheduleDraw(); return; }
    if(drag){ if(Math.abs(mx-drag.downx)+Math.abs(my-drag.downy)>3)_moved=true;
      if(drag.pan){ tx=drag.tx+(mx-drag.mx)*PAN_SENS; ty=drag.ty+(my-drag.my)*PAN_SENS; scheduleDraw(); } return; }
    const [wx,wy]=s2w(mx,my);
    // Move/edit tool, nothing being dragged: preview what ⇧ / ⌃ would do under the cursor
    if(st.seqTool==='pin'){ const h=seqHoverAt(wx,wy,e);
      if(canvas) canvas.style.cursor = h ? (h.kind==='del'?'crosshair':(h.kind==='add'?'copy':'grab')) : 'move';
      hideTip(); return; }
    const f=hitFoot(wx,wy);
    if(f) showTip(f,mx,my); else hideTip();
  };
  const onUp=(e)=>{
    pointers.delete(e.pointerId); if(pointers.size<2)_pinch=null;
    // ── sequence authoring commits first (vertex/pin drag, zone vertex, route pick) ──
    if(_seqDrag || _seqClick){ const [mx0,my0]=evPos(e); const w=s2w(mx0,my0); if(seqOnUp(w[0],w[1])) return; }
    // ── mark done: tap (no drag) toggles the footing under the finger ──
    if(st.tool==='markdone' && drag){ const wasMoved=_moved; drag=null; if(canvas) canvas.style.cursor='pointer';
      if(!wasMoved){ const [mx,my]=evPos(e); const [wx,wy]=s2w(mx,my); const f=hitFoot(wx,wy,10);
        if(f && !f.del){ const nowDone=!isDone(f);
          _footStatus['fnd'+f.no]=nowDone?'DONE':'';   // optimistic — outer store + Firebase echo confirm
          startPulse(f,nowDone); popCheck(f,nowDone); syncChrome(); scheduleDraw();
          if(_footToggleCb){ try{ _footToggleCb(f.no, nowDone); }catch(err){ console.error('footing toggle', err); } }
        } }
      return; }
    // ── markup: region commit ──
    if(_markBand){ const b=_markBand; _markBand=null;
      if(_moved && Math.abs(b.x1-b.x0)>6/scale && Math.abs(b.y1-b.y0)>6/scale){
        addMarkup({type:'region',pts:[[Math.min(b.x0,b.x1),Math.min(b.y0,b.y1)],[Math.max(b.x0,b.x1),Math.max(b.y0,b.y1)]],color:st.markColor});
      } else scheduleDraw();
      return;
    }
    // ── markup: end corner-resize ──
    if(_markResize){ const moved=_moved; _markResize=null; if(moved){ fireMarkupChange(); refresh(); } return; }
    // ── markup: end move-drag ──
    if(_markDrag){ const moved=_moved; _markDrag=null; if(moved){ fireMarkupChange(); refresh(); } return; }
    // ── footing: end group / single move-drag ──
    if(_groupDrag){ const moved=_groupDrag.moved; _groupDrag=null; if(moved){ fireFootingEdit(); refresh(); } else scheduleDraw(); return; }
    if(_footDrag){ _footDrag=null; refresh(); return; }
    // ── Explore: marquee multi-select (or click to select one) ──
    if(_selBand){ const b=_selBand; _selBand=null;
      if(_moved && (Math.abs(b.x1-b.x0)+Math.abs(b.y1-b.y0))*scale > 5){
        const x0=Math.min(b.x0,b.x1),x1=Math.max(b.x0,b.x1),y0=Math.min(b.y0,b.y1),y1=Math.max(b.y0,b.y1);
        if(!b.add) selFootings=new Set();
        footings.forEach(f=>{ if(f.del) return; let px=f.cx, py=f.cy; if(f.isBeam&&f.beam){ px=(f.beam.x1+f.beam.x2)/2; py=(f.beam.y1+f.beam.y2)/2; } if(px>=x0&&px<=x1&&py>=y0&&py<=y1) selFootings.add(f.no); });
        selFootingNo = selFootings.size===1 ? [...selFootings][0] : null; selMarkupId=null;
        syncChrome(); renderPanel(); scheduleDraw();
      } else {
        const [mx,my]=evPos(e); const [wx,wy]=s2w(mx,my); const f=hitFoot(wx,wy);
        if(f && !f.del){ selectFooting(f.no); doFlash(f.no); }
        else { selFootings=new Set(); selFootingNo=null; const p=hitPour(wx,wy); selectPourId(p?p.id:null); }
      }
      return;
    }
    // ── add-footing: drop a new footing where you click (stays armed for more) ──
    if(st.tool==='addfoot' && drag && !_moved){
      const [mx,my]=evPos(e); const [wx,wy]=s2w(mx,my); drag=null;
      addFooting({ type:st.addType||_lastAddType||'F8', cx:wx, cy:wy });
      return;
    }
    // ── markup: polyline vertex / text placement (single click, no drag) ──
    if((st.tool==='polyline'||st.tool==='text') && drag && !_moved){
      const [mx,my]=evPos(e); const [wx,wy]=s2w(mx,my); drag=null;
      if(st.tool==='polyline'){ if(!_markDraft)_markDraft={type:'polyline',pts:[]}; _markDraft.pts.push([wx,wy]); _markDraft.cursor=[wx,wy]; scheduleDraw(); }
      else openTextMarkup(wx,wy);
      return;
    }
    if(canvas) canvas.style.cursor = (st.tool==='region'||st.tool==='polyline'||st.tool==='text'||st.tool==='addfoot')?'crosshair':(st.tool==='footedit'?'move':'default');
    if(band){
      const b=band; band=null;
      if(_moved){
        const x0=Math.min(b.x0,b.x1),x1=Math.max(b.x0,b.x1),y0=Math.min(b.y0,b.y1),y1=Math.max(b.y0,b.y1);
        let changed=false; pushUndo();
        for(const f of footings){ if(f.del) continue; let px=f.cx, py=f.cy; if(f.isBeam&&f.beam){ px=(f.beam.x1+f.beam.x2)/2; py=(f.beam.y1+f.beam.y2)/2; } if(px>=x0&&px<=x1&&py>=y0&&py<=y1 && f.pourId!==st.selId){ f.pourId=st.selId; f.seq=pourById[st.selId].seq; changed=true; } }
        if(!changed) undoStack.pop();
        refresh(); if(changed) fireMembershipChange();
      } else {
        const [mx,my]=evPos(e); const [wx,wy]=s2w(mx,my); const f=hitFoot(wx,wy);
        if(f && !f.del){ pushUndo(); if(f.pourId===st.selId){f.pourId=null;f.seq=null;} else {f.pourId=st.selId;f.seq=pourById[st.selId].seq;} refresh(); fireMembershipChange(); }
      }
      return;
    }
    // (Explore clicks handled by the marquee branch above; left drag here is a pan via middle/Space)
    drag=null;
  };
  function doFlash(no){ flash={no,t:performance.now()}; scheduleDraw(); setTimeout(()=>{flash=null;scheduleDraw();},1400); }
  function startPulse(f,on){ pulses.push({cx:f.cx, cy:f.cy, r0:Math.max(f.w,f.h)/2, t0:performance.now(), on}); scheduleDraw(); }
  // Checkmark pop over a tapped footing — Motion spring (canvas can't animate DOM per footing).
  function popCheck(f,on){
    if(!mapArea) return;
    const [sx,sy]=w2s(f.cx,f.cy);
    const el=document.createElement('div');
    el.style.cssText='position:absolute;left:'+sx+'px;top:'+sy+'px;translate:-50% -50%;z-index:7;pointer-events:none;color:'+(on?'#34d399':'#94a3b8')+';text-shadow:0 2px 10px rgba(0,0,0,0.6)';
    el.innerHTML='<span class="material-symbols-outlined" style="font-size:26px;line-height:1">'+(on?'check_circle':'radio_button_unchecked')+'</span>';
    mapArea.appendChild(el);
    const M=window.Motion;
    if(M && M.animate){
      try{
        M.animate(el,{scale:[0.2,1],opacity:[0,1]},{duration:0.4,type:'spring',bounce:0.5});
        setTimeout(()=>{ try{ M.animate(el,{opacity:0,scale:1.15},{duration:0.3}); }catch(e){} },550);
      }catch(e){}
    }
    setTimeout(()=>{ if(el.parentNode) el.remove(); },950);
  }
  function showTip(f,mx,my){
    if(!tip) return; const p=f.pourId?pourById[f.pourId]:null;
    tip.innerHTML='<div style="font-family:\'Space Grotesk\',sans-serif;font-weight:700;font-size:13px;color:#fff;margin-bottom:3px">'+esc(f.type)+' <span style="color:rgba(170,188,218,0.5);font-weight:500;font-family:JetBrains Mono">'+f.tag+'</span></div>'
      +'<div style="display:flex;gap:10px;font-size:10px;font-family:JetBrains Mono;color:rgba(200,212,230,0.65)"><span>'+f.thk+'&quot; THK</span><span style="color:#52E6E0">'+f.cyv.toFixed(1)+' CY</span></div>'
      +'<div style="font-size:10px;color:rgba(170,188,218,0.5);margin-top:3px">'+(p?esc(p.name):'Unassigned')+'</div>';
    tip.style.display='block';
    let x=mx+16, y=my+16; if(x+tip.offsetWidth>cssW)x=mx-tip.offsetWidth-16; if(y+tip.offsetHeight>cssH)y=my-tip.offsetHeight-16;
    tip.style.left=x+'px'; tip.style.top=y+'px';
  }
  function hideTip(){ if(tip)tip.style.display='none'; }

  // ───────── render ─────────
  function scheduleDraw(){ if(_raf)return; _raf=requestAnimationFrame(()=>{_raf=0;draw();}); }
  // one-time left-to-right reveal of the footings on first display ("alive" on launch)
  function startIntro(){ _introT=performance.now();
    const step=()=>{ if(!_introT) return; if(performance.now()-_introT>1250){ _introT=0; scheduleDraw(); return; } draw(); requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function rrect(c,x,y,w,h,r){ r=Math.min(r,w/2,h/2); c.beginPath();
    c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }
  function draw(){
    if(!ctx||!footings)return; const sc=scale;
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,cssW,cssH);
    ctx.setTransform(sc*dpr,0,0,sc*dpr,tx*dpr,ty*dpr);
    if(underlay) ctx.drawImage(underlay,0,0,planW,planH);
    const vx0=-tx/sc, vy0=-ty/sc, vx1=vx0+cssW/sc, vy1=vy0+cssH/sc;
    if(gridCols){
      ctx.lineWidth=1/sc; ctx.strokeStyle=seqOn()?'rgba(154,176,214,0.10)':'rgba(154,176,214,0.26)'; ctx.setLineDash([6/sc,5/sc]);   // quieter grid when the sequence overlay is on
      gridCols.forEach(c=>{ if(c.x<vx0-4||c.x>vx1+4)return; ctx.beginPath(); ctx.moveTo(c.x,vy0); ctx.lineTo(c.x,vy1); ctx.stroke(); });
      gridRows.forEach(c=>{ if(c.y<vy0-4||c.y>vy1+4)return; ctx.beginPath(); ctx.moveTo(vx0,c.y); ctx.lineTo(vx1,c.y); ctx.stroke(); });
      ctx.setLineDash([]);
    }
    const filter=st.filter, cm=st.colorMode, sel=st.selId, hideC=st.hideComplete, hideRat=st.hideRatslab;
    const showTags=sc>base*2.0;
    const footAlpha=Math.max(0.4,Math.min(0.95,(sc/base-0.4)/1.2));
    // (No pour hull/area outline — sequence color lives on the footing cells themselves.)
    const colOf=(f)=>{ const p=f.pourId?pourById[f.pourId]:null; return [p, !p?(_typeColor?fndTypeCol(f.type):'#64748b'):(p.category==='ratslab'?RATSLAB_COL:(cm==='status'?FND_STAT[p.status][1]:(p.color||FND_SEQCOL[p.seq]||'#94a3b8')))]; };
    const introP = _introT ? Math.min(1,(performance.now()-_introT)/1150) : 1;
    const introOf=(f)=>{ if(!_introT) return 1; const fx=f.cx/(planW||1); return Math.max(0,Math.min(1,(introP - fx*0.45)/0.5)); };
    drawSeqZones(vx0,vy0,vx1,vy1,sc);   // sequence zones go UNDER the footings
    footings.forEach(f=>{ if(!f.isBeam||!f.beam||f.del) return; const b=f.beam;
      const ia=introOf(f); if(ia<=0) return;
      const minx=Math.min(b.x1,b.x2),maxx=Math.max(b.x1,b.x2),miny=Math.min(b.y1,b.y2),maxy=Math.max(b.y1,b.y2);
      if(minx>vx1||miny>vy1||maxx<vx0||maxy<vy0) return;
      const [p,col0]=colOf(f); if(hideC && p && p.status==='complete') return; if(hideRat && p && p.category==='ratslab') return;
      const done=isDone(f); const sq=seqFootPaint(f,done); const col=sq?sq.col:(done?'#34d399':col0);   // per-footing complete → solid green
      const dim=filter!=='ALL'&&f.seq!==filter; const isSel=p&&p.id===sel;
      let a=Math.max(footAlpha,0.55); if(isSel)a=0.95; if(done)a=Math.max(a,0.95); if(dim)a*=0.12;
      if(sq) a=sq.a;
      const bw=Math.max(5,f.w*0.78);
      ctx.globalAlpha=a*ia; ctx.fillStyle=hex2rgba(col,sq?sq.a:(done?0.92:0.5));
      if(b.horizontal) ctx.fillRect(minx,f.cy-bw/2,maxx-minx,bw); else ctx.fillRect(f.cx-bw/2,miny,bw,maxy-miny);
      ctx.globalAlpha=(dim?0.18:(sq?1:0.85))*ia; ctx.lineWidth=((sq&&sq.ring)?1.6:(isSel?1.3:0.7))/sc;
      ctx.strokeStyle=(sq&&sq.ring)?hex2rgba(sq.ring,sq.ringA||0.5):(sq?hex2rgba(col,sq.a<0.3?0.16:0.5):(done?'#10b981':col));
      if(b.horizontal) ctx.strokeRect(minx,f.cy-bw/2,maxx-minx,bw); else ctx.strokeRect(f.cx-bw/2,miny,bw,maxy-miny);
      if(selFootings.has(f.no)){ ctx.globalAlpha=1; ctx.lineWidth=2.4/sc; ctx.strokeStyle='#52E6E0';
        if(b.horizontal) ctx.strokeRect(minx-2/sc,f.cy-bw/2-2/sc,maxx-minx+4/sc,bw+4/sc); else ctx.strokeRect(f.cx-bw/2-2/sc,miny-2/sc,bw+4/sc,maxy-miny+4/sc); }
    });
    footings.forEach(f=>{ if(f.isBeam||f.del) return;
      const ia=introOf(f); if(ia<=0) return;
      const gw=f.w*(0.6+0.4*ia), gh=f.h*(0.6+0.4*ia); const x=f.cx-gw/2, y=f.cy-gh/2;
      if(x>vx1||y>vy1||x+gw<vx0||y+gh<vy0) return;
      const [p,col0]=colOf(f); if(hideC && p && p.status==='complete') return; if(hideRat && p && p.category==='ratslab') return;
      const done=isDone(f); const sq=seqFootPaint(f,done); const col=sq?sq.col:(done?'#34d399':col0);   // per-footing complete → solid green
      const dim=filter!=='ALL'&&f.seq!==filter;
      const isSelPour=p&&p.id===sel; let a=footAlpha; if(isSelPour)a=Math.max(a,0.97); if(done)a=Math.max(a,0.95); if(dim)a*=0.12;
      if(sq) a=sq.a;
      ctx.globalAlpha=a*ia; ctx.fillStyle=hex2rgba(col,sq?sq.a:(done?0.92:0.62)); ctx.fillRect(x,y,gw,gh);
      ctx.globalAlpha=(dim?0.18:1)*ia; ctx.lineWidth=((sq&&sq.ring)?1.7:(isSelPour?1.6:0.9))/sc;
      ctx.strokeStyle=(sq&&sq.ring)?hex2rgba(sq.ring,sq.ringA||0.5):(sq?hex2rgba(col,sq.a<0.3?0.16:0.55):(done?'#10b981':col)); ctx.strokeRect(x,y,gw,gh);
      if(selFootings.has(f.no)){ ctx.globalAlpha=1; ctx.lineWidth=2.4/sc; ctx.strokeStyle='#52E6E0'; ctx.strokeRect(f.cx-f.w/2-2/sc,f.cy-f.h/2-2/sc,f.w+4/sc,f.h+4/sc); }
    });
    ctx.globalAlpha=1;
    drawSeqRoutes(sc);   // crew arrows ride OVER the footings
    // ── markups (world space): highlight regions + polylines ──
    markups.forEach(m=>{ const selM=m.id===selMarkupId;
      if(m.type==='region'){ const a=m.pts[0], c2=m.pts[1]; const rx=Math.min(a[0],c2[0]),ry=Math.min(a[1],c2[1]),rw=Math.abs(c2[0]-a[0]),rh=Math.abs(c2[1]-a[1]);
        if(rx>vx1||ry>vy1||rx+rw<vx0||ry+rh<vy0) return;
        ctx.fillStyle=hex2rgba(m.color,0.16); ctx.fillRect(rx,ry,rw,rh);
        ctx.lineWidth=(selM?2.6:1.6)/sc; ctx.strokeStyle=m.color; ctx.setLineDash(selM?[]:[6/sc,4/sc]); ctx.strokeRect(rx,ry,rw,rh); ctx.setLineDash([]);
        if(selM){ const hs=5.5/sc; ctx.fillStyle='#06060e'; ctx.lineWidth=1.6/sc;   // corner resize handles
          [[rx,ry],[rx+rw,ry],[rx+rw,ry+rh],[rx,ry+rh]].forEach(c=>{ ctx.beginPath(); ctx.rect(c[0]-hs,c[1]-hs,hs*2,hs*2); ctx.fill(); ctx.stroke(); }); } }
      else if(m.type==='polyline'){ if(!m.pts||m.pts.length<2) return;
        ctx.strokeStyle=m.color; ctx.lineWidth=(selM?3.4:2.2)/sc; ctx.lineJoin='round'; ctx.lineCap='round';
        ctx.beginPath(); m.pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.stroke();
        if(selM){ ctx.fillStyle=m.color; m.pts.forEach(p=>{ ctx.beginPath(); ctx.arc(p[0],p[1],3.4/sc,0,7); ctx.fill(); }); } }
    });
    if(_markBand){ const rx=Math.min(_markBand.x0,_markBand.x1),ry=Math.min(_markBand.y0,_markBand.y1),rw=Math.abs(_markBand.x1-_markBand.x0),rh=Math.abs(_markBand.y1-_markBand.y0);
      ctx.fillStyle=hex2rgba(st.markColor,0.14); ctx.fillRect(rx,ry,rw,rh);
      ctx.strokeStyle=st.markColor; ctx.lineWidth=1.6/sc; ctx.setLineDash([6/sc,4/sc]); ctx.strokeRect(rx,ry,rw,rh); ctx.setLineDash([]); }
    if(_markDraft && _markDraft.type==='polyline' && _markDraft.pts.length){
      ctx.strokeStyle=st.markColor; ctx.lineWidth=2.2/sc; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.setLineDash([7/sc,5/sc]);
      ctx.beginPath(); _markDraft.pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); if(_markDraft.cursor) ctx.lineTo(_markDraft.cursor[0],_markDraft.cursor[1]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle=st.markColor; _markDraft.pts.forEach(p=>{ ctx.beginPath(); ctx.arc(p[0],p[1],3/sc,0,7); ctx.fill(); }); }
    ctx.globalAlpha=1;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    // Labels: always on the selected pour; on ALL pours when the "Names" toggle is on. #N via cupPourNo.
    const _pnos = st.showNames ? ((typeof cupPourNo==='function') ? cupPourNo() : {}) : null;
    pours.forEach(p=>{
      if(p.id!==sel && !st.showNames && !st.showDates) return;   // clean by default — only the selected pour is labeled
      if(hideC && p.status==='complete') return;
      if(hideRat && p.category==='ratslab') return;
      const b=pourBox(p.id); if(!b) return; const dim=filter!=='ALL'&&p.seq!==filter; if(dim)return;
      const sx=(b.x+b.w/2)*sc+tx, sy=b.y*sc+ty;
      if(sx>cssW+40||sy>cssH||sx<-160||sy<-30) return;
      const _no=_pnos?_pnos[p.id]:null;
      const mid = st.showDates ? (p.pour_date ? _fmMdFromIso(p.pour_date) : 'No date') : p.name;   // Dates toggle → show the pour date instead of its name
      const label=(p.category==='ratslab'?'▨ ':'')+(_no?('#'+_no+'  '):'')+mid+'  ·  '+fmt(pourCY(p.id))+' CY';
      ctx.font='700 11px JetBrains Mono, monospace'; const tw=ctx.measureText(label).width;
      const lcol=p.category==='ratslab'?RATSLAB_COL:(cm==='status'?FND_STAT[p.status][1]:p.color);
      ctx.fillStyle=hex2rgba(lcol,0.96); rrect(ctx,sx-tw/2-8,sy-24,tw+16,20,5); ctx.fill();
      ctx.fillStyle='#08090f'; ctx.textBaseline='middle'; ctx.textAlign='center'; ctx.fillText(label,sx,sy-13.5); ctx.textAlign='left';
    });
    if(showTags){
      ctx.font='600 9px JetBrains Mono, monospace'; ctx.textBaseline='middle'; ctx.textAlign='center';
      footings.forEach(f=>{ if(f.del)return; const dim=filter!=='ALL'&&f.seq!==filter; if(dim)return;
        const sx=f.cx*sc+tx, sy=f.cy*sc+ty; if(sx<-20||sy<-10||sx>cssW+20||sy>cssH+10)return;
        if(isDone(f)){ ctx.font='800 11px Inter, sans-serif'; ctx.fillStyle='#04291a'; ctx.fillText('✓ '+f.type,sx,sy); ctx.font='600 9px JetBrains Mono, monospace'; }
        else { ctx.fillStyle='rgba(245,250,255,0.92)'; ctx.fillText(f.type,sx,sy); } });
      ctx.textAlign='left';
    }
    if(gridCols){
      ctx.font='600 11px JetBrains Mono, monospace'; ctx.textBaseline='middle'; ctx.textAlign='center';
      let lastX=-99;
      gridCols.forEach(c=>{ const sx=c.x*sc+tx; if(sx<22||sx>cssW-8)return; if(sx-lastX<17)return; lastX=sx;
        ctx.fillStyle='rgba(9,12,20,0.92)'; ctx.beginPath(); ctx.arc(sx,15,9,0,7); ctx.fill();
        ctx.strokeStyle='rgba(150,170,205,0.4)'; ctx.lineWidth=1; ctx.stroke();
        ctx.fillStyle='rgba(205,218,238,0.92)'; ctx.fillText(c.l,sx,15); });
      let lastY=-99;
      gridRows.forEach(c=>{ const sy=c.y*sc+ty; if(sy<26||sy>cssH-8)return; if(sy-lastY<17)return; lastY=sy;
        ctx.fillStyle='rgba(9,12,20,0.92)'; ctx.beginPath(); ctx.arc(11,sy,9,0,7); ctx.fill();
        ctx.strokeStyle='rgba(150,170,205,0.4)'; ctx.lineWidth=1; ctx.stroke();
        ctx.fillStyle='rgba(205,218,238,0.92)'; ctx.fillText(c.l,11,sy); });
      ctx.textAlign='left';
    }
    // ── markup text labels (screen space, constant size) ──
    markups.forEach(m=>{ if(m.type!=='text') return; const p=m.pts[0]; const sx=p[0]*sc+tx, sy=p[1]*sc+ty;
      if(sx<-60||sy<-20||sx>cssW+60||sy>cssH+20) return;
      ctx.font='700 12px Inter, sans-serif'; ctx.textBaseline='middle'; ctx.textAlign='left'; const tw=ctx.measureText(m.text||'').width; const selM=m.id===selMarkupId;
      ctx.fillStyle='rgba(8,11,18,0.82)'; rrect(ctx,sx-6,sy-11,tw+12,22,5); ctx.fill();
      if(selM){ ctx.strokeStyle=m.color; ctx.lineWidth=1.5; ctx.stroke(); }
      ctx.fillStyle=m.color; ctx.fillText(m.text||'',sx,sy+1); });
    drawSeqChrome(sc);   // phase bubbles + crew tokens, constant size
    if(flash){ const f=byNo[flash.no]; if(f){ const dt=(performance.now()-flash.t)/1400; const r=(f.w*sc/2)+8+dt*28; const sx=f.cx*sc+tx, sy=f.cy*sc+ty;
      ctx.strokeStyle='rgba(82,230,224,'+(1-dt)+')'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(sx,sy,r,0,7); ctx.stroke(); scheduleDraw(); }}
    if(band){ const x0=band.x0*sc+tx, y0=band.y0*sc+ty, x1=band.x1*sc+tx, y1=band.y1*sc+ty;
      ctx.fillStyle='rgba(82,230,224,0.12)'; ctx.fillRect(x0,y0,x1-x0,y1-y0);
      ctx.strokeStyle='#52E6E0'; ctx.lineWidth=1.5; ctx.setLineDash([8,5]); ctx.strokeRect(x0,y0,x1-x0,y1-y0); ctx.setLineDash([]); }
    if(_selBand){ const x0=_selBand.x0*sc+tx, y0=_selBand.y0*sc+ty, x1=_selBand.x1*sc+tx, y1=_selBand.y1*sc+ty;
      ctx.fillStyle='rgba(82,230,224,0.10)'; ctx.fillRect(x0,y0,x1-x0,y1-y0);
      ctx.strokeStyle='#52E6E0'; ctx.lineWidth=1.5; ctx.setLineDash([6,4]); ctx.strokeRect(x0,y0,x1-x0,y1-y0); ctx.setLineDash([]); }
    // ── mark-done pulse rings (expanding ring, self-perpetuating like flash) ──
    if(pulses.length){ const now=performance.now();
      pulses=pulses.filter(pl=>{ const k=(now-pl.t0)/650; if(k>=1) return false;
        const e2=1-Math.pow(1-k,3); const sx=pl.cx*sc+tx, sy=pl.cy*sc+ty; const r=Math.max(pl.r0*sc,8)*(0.7+2.2*e2)+4;
        ctx.strokeStyle=pl.on?('rgba(52,211,153,'+(0.85*(1-k)).toFixed(3)+')'):('rgba(148,163,184,'+(0.7*(1-k)).toFixed(3)+')');
        ctx.lineWidth=3; ctx.beginPath(); ctx.arc(sx,sy,r,0,7); ctx.stroke(); return true; });
      if(pulses.length) scheduleDraw();
    }
  }
  function buildUnderlay(){
    const W=planW, H=planH; const c=document.createElement('canvas'); c.width=W; c.height=H; const x=c.getContext('2d');
    const g=x.createRadialGradient(W*0.42,H*0.36,0,W*0.42,H*0.36,Math.max(W,H)*0.8);
    g.addColorStop(0,'#19222F'); g.addColorStop(0.55,'#121925'); g.addColorStop(1,'#0C111A');
    x.fillStyle=g; x.fillRect(0,0,W,H);
    if(siteHull&&siteHull.length>2){
      x.beginPath(); siteHull.forEach((p,i)=>i?x.lineTo(p[0],p[1]):x.moveTo(p[0],p[1])); x.closePath();
      x.fillStyle='rgba(30,58,107,0.10)'; x.fill();   // soft site tint only — no hard outline
    }
    underlay=c;
  }

  // ───────── canvas lifecycle ─────────
  function setupCanvas(){ if(!canvas) return; ctx=canvas.getContext('2d'); _wired=true;
    canvas.addEventListener('wheel', onWheel, {passive:false});
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', hideTip);
    canvas.addEventListener('dblclick', (e)=>{ if(st.seqTool==='zone' && _seqDraft){ e.preventDefault(); _seqClick=false; finishSeqDraft(); return; }
      if(st.tool==='polyline'){ e.preventDefault(); finishPolyline(); } });
    canvas.addEventListener('mousedown', (e)=>{ if(e.button===1) e.preventDefault(); });   // suppress middle-click autoscroll
    canvas.addEventListener('auxclick', (e)=>{ if(e.button===1) e.preventDefault(); });
    // macOS turns ⌃+click into a secondary click — keep the OS menu out of the way while
    // the Move/edit tool is live, so ⌃+click can add a polyline point instead.
    canvas.addEventListener('contextmenu', (e)=>{ if(st.seqTool==='pin') e.preventDefault(); });
    if(!_keyWired){ _keyWired=true; window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp); }
  }
  // Tapping ⇧ or ⌃ without moving the mouse still has to flip the vertex affordance
  function seqSyncMods(e){ if(st.seqTool!=='pin') return;
    const h=seqHoverAt(null,null,e);
    if(canvas) canvas.style.cursor = h ? (h.kind==='del'?'crosshair':(h.kind==='add'?'copy':'grab')) : 'move'; }
  function onKeyUp(e){ if(e.code==='Space' || e.key===' '){ _spaceDown=false; if(canvas) canvas.style.cursor=(st.tool==='region'||st.tool==='polyline'||st.tool==='text'||st.tool==='addfoot')?'crosshair':(st.tool==='footedit'?'move':'default'); }
    if(e.key==='Shift'||e.key==='Control'||e.key==='Meta') seqSyncMods(e); }
  function onKey(e){
    if(!root || root.offsetParent===null) return;                       // only when this map is visible
    if(e.key==='Shift'||e.key==='Control'||e.key==='Meta') seqSyncMods(e);
    if(/INPUT|TEXTAREA|SELECT/.test((e.target&&e.target.tagName)||'')) return;
    if(e.code==='Space' || e.key===' '){ if(!_spaceDown){ _spaceDown=true; if(canvas) canvas.style.cursor='grab'; } e.preventDefault(); return; }   // hold Space to pan
    // ── zone drawing: Enter closes the polygon, Esc cancels, Backspace drops the last vertex ──
    if(_seqDraft){
      if(e.key==='Enter'){ finishSeqDraft(); e.preventDefault(); return; }
      if(e.key==='Escape'){ cancelSeqDraft(); e.preventDefault(); return; }
      if(e.key==='Backspace'){ undoSeqDraftPoint(); e.preventDefault(); return; }
    }
    if((e.ctrlKey||e.metaKey) && !e.altKey){
      const k=(e.key||'').toLowerCase();
      if(k==='z' && !e.shiftKey){ doUndo(); e.preventDefault(); return; }
      if(k==='c'){ doCopy(); e.preventDefault(); return; }
      if(k==='v'){ doPaste(); e.preventDefault(); return; }
      if(k==='a'){ selectAllFootings(); e.preventDefault(); return; }   // Revit-style select-all
      return;
    }
    // tool shortcuts
    const kk=(e.key||'').toLowerCase();
    if(kk==='v'){ setTool('select'); e.preventDefault(); return; }   // Select / marquee
    if(kk==='m'){ setTool('move'); e.preventDefault(); return; }     // Move footings
    if(kk==='b'){ setTool('assign'); e.preventDefault(); return; }   // Assign (brush) into pour
    if(kk==='l'){ setTool(st.tool==='footedit'?'select':'move'); e.preventDefault(); return; }   // toggle Move
    if(st.tool==='polyline' && _markDraft){ if(e.key==='Enter'){ finishPolyline(); e.preventDefault(); } else if(e.key==='Escape'){ _markDraft=null; scheduleDraw(); e.preventDefault(); } return; }
    if(st.tool==='markselect' && selMarkupId && (e.key==='Delete'||e.key==='Backspace')){ deleteMarkup(selMarkupId); e.preventDefault(); return; }
    if(selFootings.size && (e.key==='Delete'||e.key==='Backspace') && (st.tool==='none'||st.tool==='footedit')){ deleteSelectedFootings(); e.preventDefault(); return; }
    if(kk==='r' && selFootings.size){ rotateSelection(); e.preventDefault(); return; }   // R = rotate (swap W↔L)
    // Bluebeam-style zoom keys
    if(e.key==='+'||e.key==='='){ zoomAt(cssW/2,cssH/2,1.3); e.preventDefault(); return; }
    if(e.key==='-'||e.key==='_'){ zoomAt(cssW/2,cssH/2,1/1.3); e.preventDefault(); return; }
    if(e.key==='0'){ if(selFootings.size) zoomToSelection(); else { _fitted=true; fit(); } e.preventDefault(); return; }
    if(e.key==='Escape'){ if(st.tool!=='none'){ setTool('select'); e.preventDefault(); } else if(selFootings.size){ clearSelection(); e.preventDefault(); } return; }
  }
  function resize(){
    if(!canvas||!mapArea) return;
    const w=mapArea.clientWidth, h=mapArea.clientHeight; if(!w||!h) return;
    cssW=w; cssH=h;
    canvas.width=Math.round(w*dpr); canvas.height=Math.round(h*dpr);
    if(!_fitted){ _fitted=true; fit(); } else { scheduleDraw(); draw(); }
  }
  function fit(){
    if(!cssW||!planW) return; const m=_fitMargin;
    const s=Math.min((cssW-m*2)/planW, (cssH-m*2)/planH);
    base=s; scale=s; tx=(cssW-planW*s)/2; ty=(cssH-planH*s)/2;
    updateZoom(); scheduleDraw(); draw();
    if(!_introPlayed && footings){ _introPlayed=true; startIntro(); }
  }
  function updateZoom(){ st.zoomPct=Math.round(scale/base*100); if(zoomLabelEl) zoomLabelEl.textContent=st.zoomPct+'%'; }
  function kick(n){ n=n||0; setTimeout(()=>{
    if(canvas && mapArea && mapArea.clientWidth){ if(!_wired) setupCanvas(); resize(); }
    else if(n<80){ kick(n+1); }
  }, 24); }
  function tryInit(){
    if(footings) return;
    const geo=window.FOUNDATION_GEO;
    if(!geo){ requestAnimationFrame(tryInit); return; }
    buildData(geo); buildUnderlay(); applyMembership(); syncChrome(); renderPanel();
  }

  // ───────── membership (CUP-private persistence) ─────────
  function setMembership(map){ _pendingMembership=map||{}; if(footings && !band) applyMembership(); }
  function applyMembership(){ if(!footings||!_pendingMembership) return;
    footings.forEach(f=>{ const pid=_pendingMembership[f.no]; if(pid!=null && pourById[pid]){ f.pourId=pid; f.seq=pourById[pid].seq; } });
    refresh(); }
  function getMembership(){ const m={}; if(footings) footings.forEach(f=>{ if(f.pourId!=null && !f.del) m[f.no]=f.pourId; }); return m; }
  function fireMembershipChange(){ if(!_membershipCb) return; clearTimeout(_saveTimer);
    _saveTimer=setTimeout(()=>{ try{ _membershipCb(getMembership()); }catch(e){ console.error('foundation membership save', e); } }, 500); }

  // ───────── shared pour set (map ↔ dashboard ↔ pour day) ─────────
  function setPours(obj){ _poursExt=obj||{}; if(footings){ rebuildPours(); applyMembership(); refresh(); syncChrome(); } }
  function clearPourMembership(id){ if(!footings) return; let ch=false;
    footings.forEach(f=>{ if(f.pourId===id){ f.pourId=null; f.seq=null; ch=true; } });
    if(ch){ refresh(); fireMembershipChange(); } }
  // ───────── takeoff (dashboard rail) ─────────
  function getTakeoff(){ let cy=0,n=0; if(footings) footings.forEach(f=>{ if(f.del)return; cy+=f.cyv; n++; });
    return { totalCY:cy, footingCount:n, pourCount:pours?pours.length:0 }; }
  function onTakeoffChange(cb){ _takeoffCb=cb; if(footings) fireTakeoff(); }
  function fireTakeoff(){ if(_takeoffCb){ try{ _takeoffCb(getTakeoff()); }catch(e){} } }
  // ───────── markups (CUP-private annotations: region / polyline / text) ─────────
  function mkid(){ return 'm'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36); }
  function setMarkups(obj){ markups = obj ? Object.keys(obj).map(k=>Object.assign({},obj[k],{id:k})) : []; if(selMarkupId && !markups.some(m=>m.id===selMarkupId)) selMarkupId=null; scheduleDraw(); }
  function getMarkupsObj(){ const o={}; markups.forEach(m=>{ o[m.id]=m; }); return o; }
  function onMarkupChange(cb){ _markupCb=cb; }
  function fireMarkupChange(){ if(!_markupCb) return; clearTimeout(_markupTimer);
    _markupTimer=setTimeout(()=>{ try{ _markupCb(getMarkupsObj()); }catch(e){} }, 500); }
  function addMarkup(m){ pushUndo(); m.id=mkid(); m.createdAt=Date.now(); markups.push(m); selMarkupId=m.id; fireMarkupChange(); refresh(); }
  function deleteMarkup(id){ const i=markups.findIndex(m=>m.id===id); if(i>=0){ pushUndo(); markups.splice(i,1); if(selMarkupId===id)selMarkupId=null; fireMarkupChange(); refresh(); } }
  function clearMarkups(){ if(!markups.length) return; pushUndo(); markups=[]; selMarkupId=null; fireMarkupChange(); refresh(); }
  function distToSeg(px,py,ax,ay,bx,by){ const dx=bx-ax,dy=by-ay; const l2=dx*dx+dy*dy; if(l2===0)return Math.hypot(px-ax,py-ay);
    let t=((px-ax)*dx+(py-ay)*dy)/l2; t=Math.max(0,Math.min(1,t)); return Math.hypot(px-(ax+t*dx),py-(ay+t*dy)); }
  function markBBox(m){ let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; m.pts.forEach(p=>{ x0=Math.min(x0,p[0]); y0=Math.min(y0,p[1]); x1=Math.max(x1,p[0]); y1=Math.max(y1,p[1]); }); return {x0,y0,x1,y1}; }
  // region corner handles (0=TL,1=TR,2=BR,3=BL) for resizing the filled area
  function regionCorners(m){ const b=markBBox(m); return [[b.x0,b.y0],[b.x1,b.y0],[b.x1,b.y1],[b.x0,b.y1]]; }
  function regionHandleAt(m,wx,wy){ if(!m||m.type!=='region') return -1; const c=regionCorners(m); const tol=11/scale;
    for(let i=0;i<4;i++){ if(Math.abs(wx-c[i][0])<=tol && Math.abs(wy-c[i][1])<=tol) return i; } return -1; }
  function resizeRegionCorner(m,corner,wx,wy){ const b=markBBox(m); let x0=b.x0,y0=b.y0,x1=b.x1,y1=b.y1;
    if(corner===0){ x0=wx; y0=wy; } else if(corner===1){ x1=wx; y0=wy; } else if(corner===2){ x1=wx; y1=wy; } else { x0=wx; y1=wy; }
    m.pts=[[Math.min(x0,x1),Math.min(y0,y1)],[Math.max(x0,x1),Math.max(y0,y1)]]; }
  function hitMarkup(wx,wy){
    const tol=8/scale;
    for(let i=markups.length-1;i>=0;i--){ const m=markups[i];
      if(m.type==='region'){ const b=markBBox(m); if(wx>=b.x0-tol&&wx<=b.x1+tol&&wy>=b.y0-tol&&wy<=b.y1+tol) return m; }
      else if(m.type==='polyline'){ for(let j=1;j<m.pts.length;j++){ if(distToSeg(wx,wy,m.pts[j-1][0],m.pts[j-1][1],m.pts[j][0],m.pts[j][1])<=tol) return m; } }
      else if(m.type==='text'){ const p=m.pts[0]; const w=(m.text||'').length*8/scale+12/scale, h=22/scale; if(wx>=p[0]-6/scale&&wx<=p[0]+w&&wy>=p[1]-h&&wy<=p[1]+6/scale) return m; }
    }
    return null;
  }
  function setTool(t){
    if(t==='select'||t==='explore'){ st.mode='explore'; st.tool='none'; _locked=true; }
    else if(t==='assign'){ st.mode='assign'; st.tool='none'; _locked=true; }
    else if(t==='move'||t==='footedit'){ st.mode='explore'; st.tool='footedit'; _locked=false; }   // Move = footings draggable
    else if(t==='markdone'){ st.mode='explore'; st.tool='markdone'; _locked=true; }                // Mark done = tap toggles complete
    else { st.tool=t; _locked=true; }     // region | polyline | text | markselect | addfoot
    _markDraft=null; _markBand=null; _selBand=null; _markResize=null; if(st.tool!=='markselect') selMarkupId=null;
    if(t==='region'||t==='polyline'||t==='text'||t==='markselect'||t==='addfoot'||t==='markdone'){ selFootings=new Set(); selFootingNo=null; }
    if(canvas) canvas.style.cursor = (st.tool==='region'||st.tool==='polyline'||st.tool==='text'||st.tool==='addfoot')?'crosshair':(st.tool==='footedit'?'move':(st.tool==='markdone'?'pointer':'default'));
    syncChrome(); renderPanel(); scheduleDraw();
  }
  function setMarkColor(c){ st.markColor=c;
    if(selMarkupId){ const m=markups.find(x=>x.id===selMarkupId); if(m){ m.color=c; fireMarkupChange(); scheduleDraw(); } }
    else if(st.selId && pourById[st.selId] && typeof setFoundationPourColor==='function'){ setFoundationPourColor(st.selId, _fmHexToRgbCsv(c)); }
    syncChrome(); }
  function finishPolyline(){ if(_markDraft && _markDraft.type==='polyline' && _markDraft.pts.length>=2){ addMarkup({type:'polyline',pts:_markDraft.pts.slice(),color:st.markColor}); } _markDraft=null; scheduleDraw(); }
  function openTextMarkup(wx,wy){ const t=(typeof prompt==='function')?prompt('Label text:',''):''; if(t&&t.trim()) addMarkup({type:'text',pts:[[wx,wy]],text:t.trim(),color:st.markColor}); }

  // ───────── footing editing (CUP-private: cup-foundation/footingEdits) ─────────
  function setFootingEdits(obj){ _footEdits=obj||{}; if(_baseFoot && !_footDrag){ materializeFootings(); rebuildPours(); applyMembership(); refresh(); } }
  function onFootingEditChange(cb){ _footEditCb=cb; }
  function fireFootingEdit(){ if(!_footEditCb) return; clearTimeout(_footEditTimer); _footEditTimer=setTimeout(()=>{ try{ _footEditCb(_footEdits||{}); }catch(e){} }, 500); }

  // ───────── footing TYPE library (CUP-private: cup-foundation/footingTypes) ─────────
  // Each type (F8, PC6A, GB1 …) can carry default width/length/thickness + a default mix.
  // Editing a type's property propagates to every footing of that type across the map.
  function setTypeDefs(obj){ _typeDefs=obj||{}; if(_baseFoot && !_footDrag){ materializeFootings(); rebuildPours(); applyMembership(); refresh(); }
    if(typeof window!=='undefined' && typeof window.renderFootingTypesModal==='function') window.renderFootingTypesModal(); }
  function onTypeDefChange(cb){ _typeDefCb=cb; }
  function fireTypeDef(){ if(!_typeDefCb) return; clearTimeout(_typeDefTimer); _typeDefTimer=setTimeout(()=>{ try{ _typeDefCb(_typeDefs||{}); }catch(e){} }, 400); }
  function typeDef(t){ if(!_typeDefs)_typeDefs={}; if(!_typeDefs[t])_typeDefs[t]={}; return _typeDefs[t]; }
  // List every type currently on the map with live counts + takeoff and its library definition.
  function getTypesSummary(){
    const m={}; if(footings) footings.forEach(f=>{ if(f.del) return; const k=f.type;
      if(!m[k]) m[k]={ type:k, count:0, cy:0, beam:!!f.isBeam, wFt:f.wFt, lFt:f.lFt, thk:f.thk }; m[k].count++; m[k].cy+=f.cyv; });
    const out=Object.values(m).sort((a,b)=>{ const ax=/^GB/i.test(a.type), bx=/^GB/i.test(b.type); if(ax!==bx) return ax?1:-1; return b.cy-a.cy; });
    out.forEach(r=>{ const ov=(_typeDefs&&_typeDefs[r.type])||{}; const bl=(typeof FOOTING_TYPE_LIBRARY!=='undefined'&&FOOTING_TYPE_LIBRARY[r.type])||{};
      const pick=(f)=>ov[f]!=null?ov[f]:(bl[f]!=null?bl[f]:null);
      r.over={ wFt:ov.wFt, lFt:ov.lFt, thk:ov.thk, mix:ov.mix||null };   // saved per-type override (vs built-in library)
      r.def={ wFt:pick('wFt'), lFt:pick('lFt'), thk:pick('thk'), mix:ov.mix||null }; });   // effective defaults
    return out;
  }
  // Set a type-level property. Dimension changes clear matching per-footing overrides so the
  // whole map updates uniformly ("edit the type → every footing of that type follows").
  function setTypeProp(type, field, value){
    if(!type) return; pushUndo(); const d=typeDef(type);
    if(field==='mix'){ d.mix = value||null; }
    else { const s=String(value==null?'':value).trim();
      if(s===''){ delete d[field]; }
      else { const v=parseFloat(s); if(isNaN(v)){ undoStack.pop(); return; } d[field]=v; }
      if(_footEdits) Object.keys(_footEdits).forEach(no=>{ const f=byNo&&byNo[no]; if(f && f.type===type && _footEdits[no][field]!=null){ delete _footEdits[no][field]; if(!Object.keys(_footEdits[no]).filter(k=>k!=='added').length && !_footEdits[no].added) delete _footEdits[no]; } });
      fireFootingEdit();
    }
    fireTypeDef(); materializeFootings(); rebuildPours(); applyMembership(); refresh();
  }
  function clearTypeDef(type){ if(!_typeDefs||!_typeDefs[type]) return; pushUndo(); delete _typeDefs[type]; fireTypeDef(); materializeFootings(); rebuildPours(); applyMembership(); refresh(); }
  // ───────── Revit-style instance selection ─────────
  function selectType(type){ if(!footings) return; selMarkupId=null; selFootings=new Set();
    footings.forEach(f=>{ if(!f.del && f.type===type) selFootings.add(f.no); });
    selFootingNo = selFootings.size===1?[...selFootings][0]:null;
    st.mode='explore'; st.tool='none'; _locked=true;
    syncChrome(); renderPanel(); scheduleDraw();
    const m=byNo&&byNo[[...selFootings][0]]; if(m) zoomToSelection();
  }
  function selectAllFootings(){ if(!footings) return; selMarkupId=null; selFootings=new Set();
    footings.forEach(f=>{ if(!f.del) selFootings.add(f.no); });
    selFootingNo=null; st.mode='explore'; st.tool='none'; _locked=true; syncChrome(); renderPanel(); scheduleDraw(); }
  function clearSelection(){ selFootings=new Set(); selFootingNo=null; renderPanel(); scheduleDraw(); }
  function zoomToSelection(){
    if(!selFootings.size) return; let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    selFootings.forEach(no=>{ const f=byNo[no]; if(!f||f.del) return; x0=Math.min(x0,f.cx-f.w/2); y0=Math.min(y0,f.cy-f.h/2); x1=Math.max(x1,f.cx+f.w/2); y1=Math.max(y1,f.cy+f.h/2); });
    if(x1<x0) return; const bw=Math.max(40,x1-x0), bh=Math.max(40,y1-y0), pad=80;
    const ns=Math.max(base*0.6, Math.min(base*14, Math.min((cssW-pad*2)/bw,(cssH-pad*2)/bh)));
    scale=ns; tx=cssW/2-(x0+x1)/2*ns; ty=cssH/2-(y0+y1)/2*ns; updateZoom(); scheduleDraw(); draw();
  }
  // bulk-resize the current multi-selection (writes per-footing overrides)
  function setSelectionDim(field, value){ if(!selFootings.size) return; const v=parseFloat(value); if(isNaN(v)) return; pushUndo();
    selFootings.forEach(no=>{ const f=byNo[no]; if(!f||f.del) return; f[field]=v; footEdit(no)[field]=v; recompFoot(f); });
    fireFootingEdit(); refresh(); }
  // Rotate selected footings 90° = swap width ↔ length (per-footing override). Beams are skipped
  // (their orientation comes from neighbor geometry, not W/L).
  function rotateSelection(){ if(!selFootings.size) return; pushUndo(); let any=false;
    selFootings.forEach(no=>{ const f=byNo[no]; if(f && !f.del && !f.isBeam){ const nw=f.lFt, nl=f.wFt; f.wFt=nw; f.lFt=nl; const e=footEdit(no); e.wFt=nw; e.lFt=nl; recompFoot(f); any=true; } });
    if(any){ fireFootingEdit(); refresh(); } else undoStack.pop(); }
  // Add-footing placement: arm a type, next map click drops one (kept armed to place several).
  function armAddFooting(type){ _lastAddType=String(type||_lastAddType||'F8').trim()||'F8'; st.addType=_lastAddType; setTool('addfoot'); }
  function footEdit(no){ if(!_footEdits)_footEdits={}; if(!_footEdits[no])_footEdits[no]={}; if(byNo&&byNo[no]&&byNo[no].added)_footEdits[no].added=true; return _footEdits[no]; }
  function editFooting(no, field, value){ const f=byNo&&byNo[no]; if(!f) return; pushUndo();
    if(field==='type'){ const t=String(value); f.type=t; const e=footEdit(no); e.type=t;
      delete e.wFt; delete e.lFt; delete e.thk; delete e.beam;   // drop manual size so it adopts the new type's properties
      const s=sideFt(t); f.wFt=dimFor('wFt',t,e,s); f.lFt=dimFor('lFt',t,e,s); f.thk=dimFor('thk',t,e,30); f.mix=mixFor(t); }
    else { const v=parseFloat(value); if(isNaN(v))return;
      if(f.isBeam && f.beam && field==='lFt'){            // beam Length = its span; rescale (centered, keep orientation)
        const len=Math.max(9, v*2.43);
        f.beam = f.beam.horizontal ? {x1:f.cx-len/2,y1:f.cy,x2:f.cx+len/2,y2:f.cy,horizontal:true}
                                   : {x1:f.cx,y1:f.cy-len/2,x2:f.cx,y2:f.cy+len/2,horizontal:false};
        footEdit(no).beam=Object.assign({}, f.beam); f.lFt=v; footEdit(no).lFt=v;
      } else { f[field]=v; footEdit(no)[field]=v; }
    }
    recompFoot(f); fireFootingEdit(); refresh(); }
  function setFootingNote(no, note){ const f=byNo&&byNo[no]; if(!f)return; pushUndo(); f.note=note; footEdit(no).note=note; fireFootingEdit(); renderPanel(); }
  // Drop this footing's manual size tweaks so it follows its type's schedule/library properties again.
  function resetFootingToType(no){ const f=byNo&&byNo[no]; if(!f) return; const e=_footEdits&&_footEdits[no]; if(!e) return; pushUndo();
    delete e.wFt; delete e.lFt; delete e.thk; delete e.beam;
    const keys=Object.keys(e).filter(k=>k!=='added'); if(!keys.length && !e.added) delete _footEdits[no];
    materializeFootings(); rebuildPours(); applyMembership(); fireFootingEdit(); refresh(); }
  function moveFooting(no, cx, cy, snap){ const f=byNo&&byNo[no]; if(!f)return; if(snap)pushUndo(); const e=footEdit(no);
    if(f.isBeam && f.beam){ const dx=cx-f.cx, dy=cy-f.cy; f.beam={x1:f.beam.x1+dx,y1:f.beam.y1+dy,x2:f.beam.x2+dx,y2:f.beam.y2+dy,horizontal:f.beam.horizontal};   // drag the whole beam span
      if(e.beam) e.beam=Object.assign({}, f.beam); }
    f.cx=cx; f.cy=cy; e.cx=cx; e.cy=cy; fireFootingEdit(); }
  // If you press on a footing that's part of a multi-selection, drag the whole group at once.
  function tryGroupDrag(f, wx, wy){
    if(!f || f.del || selFootings.size<2 || !selFootings.has(f.no)) return false;
    const orig={}; selFootings.forEach(no=>{ const g=byNo[no]; if(g&&!g.del) orig[no]={cx:g.cx,cy:g.cy}; });
    _groupDrag={ wx, wy, orig, moved:false }; return true;
  }
  function deleteFooting(no){ const f=byNo&&byNo[no]; if(!f)return; pushUndo(); f.del=true; footEdit(no).deleted=true; if(selFootingNo===no)selFootingNo=null; fireFootingEdit(); rebuildPours(); refresh(); }
  function nextFootNo(){ let m=9999; if(footings) footings.forEach(f=>{ if(f.no>m)m=f.no; }); return m+1; }
  function addFooting(spec){ pushUndo(); const no=nextFootNo(); const t=spec.type||'F8'; const s=sideFt(t);
    // store only what's explicit — dimensions left blank inherit the type library so the new footing matches its type
    const e={ added:true, type:t, cx:spec.cx!=null?spec.cx:planW/2, cy:spec.cy!=null?spec.cy:planH/2, note:spec.note||'' };
    if(spec.wFt!=null)e.wFt=+spec.wFt; if(spec.lFt!=null)e.lFt=+spec.lFt; if(spec.thk!=null)e.thk=+spec.thk;
    if(!_footEdits)_footEdits={}; _footEdits[no]=e;
    const f={ no, type:t, cx:e.cx, cy:e.cy, tag:'#'+no, note:e.note, wFt:dimFor('wFt',t,e,s), lFt:dimFor('lFt',t,e,s), thk:dimFor('thk',t,e,30), mix:mixFor(t), pourId:null, seq:null, added:true, del:false, isBeam:false };
    recompFoot(f); footings.push(f); byNo[no]=f; selFootingNo=no; selMarkupId=null; fireFootingEdit(); refresh(); return f; }
  function selectFooting(no){ selFootingNo=no; selFootings=new Set([no]); selMarkupId=null; renderPanel(); scheduleDraw(); }
  function assignSelectedToPour(pid){ if(!selFootings.size) return; pushUndo(); let ch=false;
    selFootings.forEach(no=>{ const f=byNo[no]; if(f && !f.del && f.pourId!==(pid||null)){ f.pourId=pid||null; f.seq=(pid&&pourById[pid])?pourById[pid].seq:null; ch=true; } });
    if(ch){ refresh(); fireMembershipChange(); } else undoStack.pop(); }
  function deleteSelectedFootings(){ if(!selFootings.size) return; pushUndo(); selFootings.forEach(no=>{ const f=byNo[no]; if(f){ f.del=true; footEdit(no).deleted=true; } }); selFootings=new Set(); selFootingNo=null; fireFootingEdit(); rebuildPours(); refresh(); }
  function setLocked(v){ _locked=!!v; syncChrome(); }

  // ───────── copy / paste / undo ─────────
  function snapshotState(){ try{ return JSON.stringify({ edits:_footEdits||{}, marks:getMarkupsObj(), mem:getMembership() }); }catch(e){ return null; } }
  function pushUndo(){ const s=snapshotState(); if(s){ undoStack.push(s); if(undoStack.length>30) undoStack.shift(); } }
  function doUndo(){ if(!undoStack.length) return; let o; try{ o=JSON.parse(undoStack.pop()); }catch(e){ return; }
    const keepFoot=selFootingNo, keepSet=[...selFootings];
    _footEdits=o.edits||{}; markups = o.marks?Object.keys(o.marks).map(k=>Object.assign({},o.marks[k],{id:k})):[]; _pendingMembership=o.mem||{};
    materializeFootings(); rebuildPours(); applyMembership();
    selFootings=new Set(keepSet.filter(no=>byNo[no] && !byNo[no].del));      // keep selection through undo
    selFootingNo=(keepFoot!=null && byNo[keepFoot] && !byNo[keepFoot].del)?keepFoot:(selFootings.size===1?[...selFootings][0]:null);
    if(selMarkupId && !markups.some(m=>m.id===selMarkupId)) selMarkupId=null;
    fireFootingEdit(); fireMarkupChange(); fireMembershipChange(); refresh(); }
  function doCopy(){ if(selFootingNo!=null && byNo[selFootingNo]){ const f=byNo[selFootingNo]; clipboard={kind:'footing',data:{type:f.type,wFt:f.wFt,lFt:f.lFt,thk:f.thk,note:f.note}}; }
    else if(selMarkupId){ const m=markups.find(x=>x.id===selMarkupId); if(m) clipboard={kind:'markup',data:JSON.parse(JSON.stringify(m))}; } }
  function doPaste(){ if(!clipboard) return; const d=22;
    if(clipboard.kind==='footing'){ const s=clipboard.data; const base=(selFootingNo!=null&&byNo[selFootingNo])?byNo[selFootingNo]:null; const cx=(base?base.cx:planW/2)+d, cy=(base?base.cy:planH/2)+d; addFooting({type:s.type,wFt:s.wFt,lFt:s.lFt,thk:s.thk,note:s.note,cx,cy}); }
    else if(clipboard.kind==='markup'){ const m=clipboard.data; addMarkup({type:m.type,pts:(m.pts||[]).map(p=>[p[0]+d,p[1]+d]),color:m.color,text:m.text}); } }

  // ───────── chrome + panel ─────────
  function btnStyle(on){ return `border:none;cursor:pointer;border-radius:7px;padding:6px 13px;font-size:11px;font-weight:700;font-family:Inter,sans-serif;transition:all .15s;${on?'background:rgba(82,230,224,0.16);color:#7df0ec;box-shadow:inset 0 0 0 1px rgba(82,230,224,0.4)':'background:transparent;color:rgba(200,212,230,0.55)'}`; }
  function selectPourId(id){ st.selId=id||null; selFootingNo=null; selFootings=new Set(); syncChrome(); renderPanel(); scheduleDraw(); }
  function setFilter(f){ st.filter=f; syncChrome(); scheduleDraw(); }
  function setHideComplete(v){ st.hideComplete=!!v; try{ localStorage.setItem('cup_fnd_hidedone', v?'1':'0'); }catch(e){} syncChrome(); renderPanel(); scheduleDraw(); }
  function toggleHideComplete(){ setHideComplete(!st.hideComplete); }
  function setShowNames(v){ st.showNames=!!v; try{ localStorage.setItem('cup_fnd_shownames', v?'1':'0'); }catch(e){} syncChrome(); scheduleDraw(); }
  function toggleShowNames(){ setShowNames(!st.showNames); }
  function setShowDates(v){ st.showDates=!!v; try{ localStorage.setItem('cup_fnd_showdates', v?'1':'0'); }catch(e){} syncChrome(); scheduleDraw(); }
  function toggleShowDates(){ setShowDates(!st.showDates); }
  function setHideRatslab(v){ st.hideRatslab=!!v; try{ localStorage.setItem('cup_fnd_hideratslab', v?'1':'0'); }catch(e){} syncChrome(); renderPanel(); scheduleDraw(); }
  function toggleHideRatslab(){ setHideRatslab(!st.hideRatslab); }
  function hasRatslab(){ return !!(pours && pours.some(p=>p.category==='ratslab')); }
  function hideCompleteStyle(on){ return `display:inline-flex;align-items:center;gap:5px;border:1px solid ${on?'rgba(82,230,224,0.5)':'rgba(150,170,205,0.2)'};background:${on?'rgba(82,230,224,0.14)':'rgba(255,255,255,0.03)'};color:${on?'#7df0ec':'rgba(200,212,230,0.7)'};border-radius:8px;padding:5px 11px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter`; }
  function setColorMode(m){ st.colorMode=m; syncChrome(); scheduleDraw(); }
  function setMode(m){ st.mode=m; syncChrome(); renderPanel(); }
  function refresh(){ scheduleDraw(); renderPanel(); fireTakeoff(); }
  function doSearch(q){
    q=String(q||'').trim().toLowerCase(); if(!q||!footings)return;
    let hit=null;
    if(/^#?\d+$/.test(q)){ hit=byNo[+q.replace('#','')]; }
    if(!hit) hit=footings.find(f=>f.type.toLowerCase()===q) || footings.find(f=>f.type.toLowerCase().indexOf(q)===0);
    if(hit){ const ns=base*4.5; scale=ns; tx=cssW/2-hit.cx*ns; ty=cssH/2-hit.cy*ns; updateZoom(); doFlash(hit.no); if(hit.pourId)selectPourId(hit.pourId); }
  }
  function updateModeHint(){
    if(!modeHintEl) return;
    const selP=st.selId&&pourById?pourById[st.selId]:null;
    let t;
    if(st.tool==='addfoot') t='Add footing → click on the map to drop a “'+(st.addType||_lastAddType)+'”. Press R to rotate · Esc to stop.';
    else if(st.tool==='region') t='Highlight → drag a box to draw a colored region.';
    else if(st.tool==='polyline') t='Polyline → click points, double-click or Enter to finish, Esc to cancel.';
    else if(st.tool==='text') t='Text → click where you want a label.';
    else if(st.tool==='markselect') t='Edit markup → click a region to select it, drag its corner handles to resize the filled area, drag the body to move it, Delete to remove.';
    else if(st.tool==='markdone') t='Mark done → tap a footing to mark it complete; tap a green one to undo. Drag to pan · pinch to zoom · Esc to exit.';
    else if(st.tool==='footedit') t='Move → drag a footing to reposition it · R rotates · click to edit. Middle-mouse to pan.';
    else if(st.mode==='assign') t=(selP?('Assign → drag over footings to add them to “'+selP.name+'”.'):'Pick a pour (right panel), then drag over footings to add them to it.');
    else t='Select → click a footing to edit it, drag a box to select many (V). Middle-mouse drag to pan · scroll to zoom.';
    modeHintEl.textContent=t;
  }
  function renderChips(){
    if(!elChips||!pours) return;
    const withFtg=new Set((footings||[]).filter(f=>!f.del && f.pourId!=null).map(f=>f.seq).filter(s=>s!==''&&s!=null));
    const seqs=[...withFtg]
      .sort((a,b)=>{ const na=parseFloat(a),nb=parseFloat(b),an=!isNaN(na),bn=!isNaN(nb); return (an&&bn)?na-nb:(an?-1:(bn?1:String(a).localeCompare(String(b)))); });
    const colOf=s=>{ const p=pours.find(p=>p.seq===s&&p.color); return (p&&p.color)||FND_SEQCOL[s]||'#94a3b8'; };
    const chip=(id,label,col,on)=>`<button data-filter="${id}" style="display:flex;align-items:center;gap:5px;border:1px solid ${on?(col||'rgba(82,230,224,0.6)'):'rgba(150,170,205,0.14)'};background:${on?hex2rgba(col||'#52E6E0',0.2):'rgba(0,0,0,0.25)'};color:${on?'#fff':'rgba(200,212,230,0.6)'};border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter"><span style="width:8px;height:8px;border-radius:2px;background:${col||'#52E6E0'};display:inline-block;flex:none"></span>${label}</button>`;
    let h=chip('ALL','All','#52E6E0',st.filter==='ALL');
    seqs.forEach(s=>{ const num=/^[0-9.]/.test(String(s)); h+=chip(s,(num?'Seq '+s:s),colOf(s),st.filter===s); });
    elChips.innerHTML=h;
  }
  function renderSwatches(){ if(!swatchesEl) return;
    swatchesEl.innerHTML = FND_SWATCHES.map(c=>`<button data-sw="${c}" title="${c}" style="width:18px;height:18px;border-radius:5px;cursor:pointer;padding:0;background:${c};border:2px solid ${c===st.markColor?'#fff':'transparent'};box-shadow:0 0 0 1px rgba(0,0,0,0.4)"></button>`).join(''); }
  function syncChrome(){
    if(!_built) return;
    elModeExplore.setAttribute('style', btnStyle(st.tool==='none' && st.mode==='explore'));
    elModeAssign.setAttribute('style', btnStyle(st.tool==='none' && st.mode==='assign'));
    const mf=root.querySelector('[data-fm="modeFooting"]'); if(mf) mf.setAttribute('style', btnStyle(st.tool==='footedit'));
    const afb=root.querySelector('[data-fm="addfootBtn"]'); if(afb){ const on=st.tool==='addfoot'; afb.textContent = on?('Placing '+(st.addType||_lastAddType)+'… (Esc)'):'+ Footing'; afb.style.background=on?'rgba(167,139,250,0.3)':'rgba(167,139,250,0.14)'; afb.style.borderColor=on?'rgba(167,139,250,0.8)':'rgba(167,139,250,0.45)'; }
    elColorStatus.setAttribute('style', btnStyle(st.colorMode==='status'));
    elColorSeq.setAttribute('style', btnStyle(st.colorMode==='sequence'));
    const hc=root.querySelector('[data-fm="hideComplete"]'); if(hc){ const on=st.hideComplete; hc.setAttribute('style', hideCompleteStyle(on)); const ic=hc.querySelector('[data-ic]'); if(ic) ic.textContent=on?'visibility_off':'visibility'; const lb=hc.querySelector('[data-lbl]'); if(lb) lb.textContent=on?'Complete hidden':'Hide complete'; }
    const md=root.querySelector('[data-fm="markDone"]'); if(md){ const on=st.tool==='markdone';
      const mgr=(window.location.search||'').indexOf('view=manager')>=0;
      md.setAttribute('style', hideCompleteStyle(on).replace(/82,230,224/g,'52,211,153').replace(/#7df0ec/g,'#6ee7b7')+(mgr?';display:none':''));
      const ic=md.querySelector('[data-ic]'); if(ic) ic.textContent=on?'task_alt':'check_circle';
      const lb=md.querySelector('[data-lbl]'); if(lb) lb.textContent=on?'Marking done… (tap footings)':'Mark done'; }
    const sn=root.querySelector('[data-fm="showNames"]'); if(sn){ const on=st.showNames; sn.setAttribute('style', hideCompleteStyle(on)); const ic=sn.querySelector('[data-ic]'); if(ic) ic.textContent=on?'label':'label_off'; const lb=sn.querySelector('[data-lbl]'); if(lb) lb.textContent=on?'Names on':'Names'; }
    const sd=root.querySelector('[data-fm="showDates"]'); if(sd){ const on=st.showDates; sd.setAttribute('style', hideCompleteStyle(on)); const ic=sd.querySelector('[data-ic]'); if(ic) ic.textContent=on?'event':'event_busy'; const lb=sd.querySelector('[data-lbl]'); if(lb) lb.textContent=on?'Dates on':'Dates'; }
    const rs=root.querySelector('[data-fm="hideRatslab"]'); if(rs){ const on=st.hideRatslab; const has=hasRatslab(); rs.setAttribute('style', hideCompleteStyle(on)+(has?'':';display:none')); const ic=rs.querySelector('[data-ic]'); if(ic) ic.textContent=on?'grid_off':'grid_on'; const lb=rs.querySelector('[data-lbl]'); if(lb) lb.textContent=on?'Rat slabs hidden':'Rat slabs'; }
    if(toolsRowEl) toolsRowEl.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('style', btnStyle(st.tool===b.getAttribute('data-tool'))));
    renderSwatches();
    if(footings && headlineEl){ const _live=footings.filter(f=>!f.del); const _dn=_live.filter(isDone).length;
      headlineEl.textContent = _live.length+' footings · '+pours.length+' pours'+(_dn?(' · '+_dn+' done ('+Math.round(_dn/_live.length*100)+'%)'):' · real plan'); }
    renderChips();
    updateModeHint();
  }
  // ── add-footing type picker (right-side panel) ──
  function addTypeWL(t){ const bl=(typeof FOOTING_TYPE_LIBRARY!=='undefined'&&FOOTING_TYPE_LIBRARY[t])||{}; const w=bl.wFt!=null?bl.wFt:sideFt(t); const l=bl.lFt!=null?bl.lFt:sideFt(t); return [w,l]; }
  function addRowStyle(on){ return `display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;border:1px solid ${on?'rgba(167,139,250,0.6)':'rgba(150,170,205,0.1)'};background:${on?'rgba(167,139,250,0.16)':'rgba(255,255,255,0.02)'};border-radius:8px;padding:7px 10px;cursor:pointer;font-family:Inter;margin-bottom:4px`; }
  function setAddType(t){ _lastAddType=t; st.addType=t;
    if(panelHost){ panelHost.querySelectorAll('[data-add-row]').forEach(r=>r.setAttribute('style', addRowStyle(r.getAttribute('data-add-row')===t)));
      const cur=panelHost.querySelector('[data-add-current]'); if(cur) cur.textContent=t; }
    updateModeHint(); }
  function renderAddPanel(){
    const lib=(typeof FOOTING_TYPE_LIBRARY!=='undefined')?FOOTING_TYPE_LIBRARY:{};
    const present={}; (getTypesSummary()||[]).forEach(r=>present[r.type]=r.count);
    const fam=t=>{ t=t.toUpperCase(); if(t.startsWith('MPC'))return 2; if(t.startsWith('PC'))return 1; if(t[0]==='F')return 0; if(t.startsWith('GB'))return 3; if(t.startsWith('WF'))return 4; return 5; };
    const types=[...new Set([...Object.keys(lib), ...Object.keys(present)])]
      .sort((a,b)=>{ const fa=fam(a),fb=fam(b); if(fa!==fb)return fa-fb; return a.localeCompare(b,undefined,{numeric:true}); });
    const q=(_addFilter||'').trim().toLowerCase();
    const rows=types.map(t=>{ const [w,l]=addTypeWL(t); const cnt=present[t]||0; const hide=q&&t.toLowerCase().indexOf(q)<0;
      return `<button data-add-type="${esc(t)}" data-add-row="${esc(t)}" style="${addRowStyle(t===st.addType)}${hide?';display:none':''}">`
        +`<span style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:#eef2f8">${esc(t)}</span>`
        +`<span style="font-size:10.5px;color:rgba(170,188,218,0.6);font-family:'JetBrains Mono',monospace">${w}×${l} ft${cnt?` · ${cnt} on map`:''}</span></button>`; }).join('');
    panelHost.innerHTML = `<div style="padding:14px 14px 18px">`
      +`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px"><span style="font-size:9px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#c4b5fd">Add footing</span><button data-add-stop="1" style="font-size:10px;font-weight:700;color:rgba(170,188,218,0.6);background:none;border:none;cursor:pointer;font-family:Inter">Done</button></div>`
      +`<div style="font-size:10.5px;color:rgba(170,188,218,0.55);line-height:1.4;margin-bottom:9px">Pick a type → click on the map to place it. <b style="color:#c4b5fd">R</b> rotates · <b style="color:#c4b5fd">Esc</b> stops.</div>`
      +`<div style="font-size:11px;color:rgba(200,212,230,0.7);margin-bottom:9px">Placing: <b data-add-current style="color:#c4b5fd;font-family:'JetBrains Mono',monospace">${esc(st.addType||_lastAddType)}</b></div>`
      +`<input data-add-filter placeholder="Filter types…" value="${esc(_addFilter)}" style="width:100%;box-sizing:border-box;background:rgba(8,11,18,0.8);border:1px solid rgba(150,170,205,0.16);border-radius:8px;padding:7px 10px;color:#fff;font-size:12px;font-family:'JetBrains Mono',monospace;outline:none;margin-bottom:9px">`
      +`<div style="display:flex;flex-direction:column">${rows}</div></div>`;
  }
  function renderPanel(){
    if(!_showPanel || !panelHost) return;
    if(!footings){ panelHost.innerHTML=''; return; }
    if(st.tool==='addfoot'){ renderAddPanel(); return; }
    const S=st, stat=FND_STAT;
    const _mgr=(window.location.search||'').indexOf('view=manager')>=0;
    const selF=(selFootingNo!=null && byNo)?byNo[selFootingNo]:null;
    const selP=S.selId?pourById[S.selId]:null;
    let html='';
    if(selFootings.size>1){
      let gcy=0; const gtypes={}; let gn=0, gdone=0;
      selFootings.forEach(no=>{ const f=byNo[no]; if(!f||f.del)return; gn++; gcy+=f.cyv; gtypes[f.type]=(gtypes[f.type]||0)+1; if(isDone(f)) gdone++; });
      const trows=Object.keys(gtypes).sort().map(t=>`<span style="font-family:JetBrains Mono,monospace;font-size:10px;color:#cdd6e6;background:rgba(255,255,255,0.05);border-radius:5px;padding:2px 6px">${esc(t)}×${gtypes[t]}</span>`).join(' ');
      const pourBtns = pours.map(p=>`<button data-assign-pour="${p.id}" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:1px solid rgba(150,170,205,0.1);background:rgba(255,255,255,0.02);border-radius:9px;padding:7px 10px;cursor:pointer;font-family:Inter;margin-bottom:4px"><span style="width:10px;height:10px;border-radius:3px;flex:0 0 auto;background:${p.color}"></span><span style="flex:1;font-size:12px;color:#eef2f8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span></button>`).join('');
      html += `<div style="padding:16px;border-bottom:1px solid rgba(150,170,205,0.08)">`
        + `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span style="font-size:9px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#7df0ec">${gn} footings selected</span><button data-clear-sel="1" style="font-size:10px;font-weight:700;color:rgba(170,188,218,0.6);background:none;border:none;cursor:pointer;font-family:Inter">Clear</button></div>`
        + `<div style="display:flex;gap:10px;margin-bottom:11px"><div style="flex:1;padding:10px 12px;border-radius:11px;background:rgba(0,0,0,0.3);border:1px solid rgba(150,170,205,0.1)"><div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:23px;color:#fff;line-height:1">${fmt(gcy)}</div><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:rgba(170,188,218,0.45);margin-top:3px">Cubic yards</div></div><div style="flex:1;padding:10px 12px;border-radius:11px;background:rgba(0,0,0,0.3);border:1px solid rgba(150,170,205,0.1)"><div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:23px;color:#fff;line-height:1">${gn}</div><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:rgba(170,188,218,0.45);margin-top:3px">Footings</div></div></div>`
        + (trows?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:13px">${trows}</div>`:'')
        + (_mgr?'':`<div style="margin-bottom:13px;padding:10px;border-radius:9px;background:rgba(52,211,153,0.06);border:1px solid rgba(52,211,153,0.22)">`
            + `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px"><span style="font-size:9px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#6ee7b7">Completion</span><span style="font-size:10px;color:rgba(200,212,230,0.6);font-family:JetBrains Mono,monospace">${gdone}/${gn} done</span></div>`
            + `<div style="display:flex;gap:6px"><button data-mark-done-sel="1" title="Mark all selected footings complete (solid green)" style="flex:1;border:1px solid rgba(52,211,153,0.5);background:rgba(52,211,153,0.16);color:#6ee7b7;border-radius:7px;padding:7px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle">task_alt</span> Mark ${gn} complete</button>`
            + (gdone?`<button data-clear-done-sel="1" title="Clear complete on all selected" style="flex:0 0 auto;border:1px solid rgba(150,170,205,0.2);background:rgba(255,255,255,0.03);color:rgba(200,212,230,0.6);border-radius:7px;padding:7px 10px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter">Clear</button>`:'')
            + `</div></div>`)
        + (()=>{ const ut=Object.keys(gtypes);
            const inpb='width:100%;box-sizing:border-box;background:rgba(8,11,18,0.8);border:1px solid rgba(150,170,205,0.16);border-radius:7px;padding:6px 8px;color:#fff;font-size:12px;font-family:JetBrains Mono,monospace;outline:none';
            const lbb='font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:rgba(170,188,218,0.45);margin:0 0 3px;display:block';
            let h=`<div style="margin-bottom:13px;padding:10px;border-radius:9px;background:rgba(0,0,0,0.25);border:1px solid rgba(150,170,205,0.1)"><div style="font-size:9px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:rgba(170,188,218,0.5);margin-bottom:7px">Resize all selected</div><div style="display:flex;gap:6px"><div style="flex:1"><label style="${lbb}">W&nbsp;(ft)</label><input data-bulk-field="wFt" type="number" step="0.5" placeholder="—" style="${inpb}"></div><div style="flex:1"><label style="${lbb}">L&nbsp;(ft)</label><input data-bulk-field="lFt" type="number" step="0.5" placeholder="—" style="${inpb}"></div><div style="flex:1"><label style="${lbb}">Thk&nbsp;(in)</label><input data-bulk-field="thk" type="number" step="1" placeholder="—" style="${inpb}"></div></div>`;
            h+=`<button data-rotate-sel="1" title="Swap width & length on all selected (R)" style="width:100%;margin-top:8px;border:1px solid rgba(167,139,250,0.4);background:rgba(167,139,250,0.12);color:#c4b5fd;border-radius:7px;padding:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle">rotate_90_degrees_cw</span> Rotate all 90°</button>`;
            if(ut.length===1) h+=`<button data-edit-type="${esc(ut[0])}" style="width:100%;margin-top:6px;border:1px solid rgba(167,139,250,0.4);background:rgba(167,139,250,0.12);color:#c4b5fd;border-radius:7px;padding:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter">Edit type ${esc(ut[0])} library (updates whole map)</button>`;
            h+=`</div>`; return h; })()
        + `<div style="font-size:9px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:rgba(170,188,218,0.42);margin-bottom:7px">Assign selection to pour</div>`
        + (pours.length?pourBtns:`<div style="font-size:10.5px;color:rgba(170,188,218,0.45);margin-bottom:6px">No pours yet — hit <b style="color:#7df0ec">+ New pour</b>.</div>`)
        + `<button data-assign-pour="" style="width:100%;border:1px solid rgba(150,170,205,0.18);background:rgba(255,255,255,0.03);color:rgba(200,212,230,0.6);border-radius:9px;padding:7px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter;margin-top:4px">Unassign selection</button>`
        + `</div>`;
    } else if(selF){
      const pnm = selF.pourId&&pourById[selF.pourId]?pourById[selF.pourId].name:'Unassigned';
      const inp='width:100%;box-sizing:border-box;background:rgba(8,11,18,0.8);border:1px solid rgba(150,170,205,0.16);border-radius:7px;padding:6px 8px;color:#fff;font-size:12px;font-family:JetBrains Mono,monospace;outline:none';
      const lb='font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:rgba(170,188,218,0.45);margin:8px 0 3px;display:block';
      // for a grade beam, "Length" is its drawn span — show the real value so editing it makes sense
      const isBm = selF.isBeam && selF.beam;
      const lenVal = isBm ? +(Math.hypot(selF.beam.x2-selF.beam.x1, selF.beam.y2-selF.beam.y1)/2.43).toFixed(1) : selF.lFt;
      const wLbl = isBm ? 'Width (ft)' : 'Width (ft)', lLbl = isBm ? 'Length / span (ft)' : 'Length (ft)';
      html += `<div style="padding:14px 16px 16px;border-bottom:1px solid rgba(150,170,205,0.08)">`
        + `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px"><span style="font-size:9px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:rgba(170,188,218,0.42)">Footing ${esc(selF.tag)}${selF.added?' · added':''}</span><span style="font-size:12px;font-weight:700;color:#52E6E0;font-family:JetBrains Mono,monospace">${selF.cyv.toFixed(2)} CY</span></div>`
        + (()=>{ const dn=isDone(selF);
            return `<div style="display:flex;align-items:center;gap:8px;margin:8px 0 2px;padding:7px 10px;border-radius:9px;background:${dn?'rgba(52,211,153,0.09)':'rgba(150,170,205,0.05)'};border:1px solid ${dn?'rgba(52,211,153,0.3)':'rgba(150,170,205,0.16)'}">`
              + `<span class="material-symbols-outlined" style="font-size:16px;color:${dn?'#34d399':'rgba(200,212,230,0.45)'}">${dn?'check_circle':'radio_button_unchecked'}</span>`
              + `<span style="flex:1;font-size:11px;font-weight:700;color:${dn?'#6ee7b7':'rgba(200,212,230,0.7)'}">${dn?'Complete':'Not complete'}</span>`
              + (_mgr?'':`<button data-foot-setdone="${dn?'0':'1'}" data-foot-no="${selF.no}" title="${dn?'Marked complete by mistake? Set it back to incomplete':'Mark this footing complete (solid green)'}" style="border:1px solid ${dn?'rgba(150,170,205,0.28)':'rgba(52,211,153,0.5)'};background:${dn?'rgba(255,255,255,0.03)':'rgba(52,211,153,0.16)'};color:${dn?'rgba(210,222,240,0.8)':'#6ee7b7'};border-radius:7px;padding:5px 11px;font-size:10.5px;font-weight:700;cursor:pointer;font-family:Inter">${dn?'Mark incomplete':'Mark complete'}</button>`)
              + `</div>`; })()
        + `<label style="${lb}">Type</label><input data-foot-field="type" value="${esc(selF.type)}" style="${inp}">`
        + `<div style="display:flex;gap:8px"><div style="flex:1"><label style="${lb}">${wLbl}</label><input data-foot-field="wFt" type="number" step="0.5" value="${selF.wFt}" style="${inp}"></div><div style="flex:1"><label style="${lb}">${lLbl}</label><input data-foot-field="lFt" type="number" step="0.5" value="${lenVal}" style="${inp}"></div></div>`
        + `<div style="display:flex;gap:8px"><div style="flex:1"><label style="${lb}">Thickness (in)</label><input data-foot-field="thk" type="number" step="1" value="${selF.thk}" style="${inp}"></div><div style="flex:1"><label style="${lb}">Pour</label><div style="${inp};color:rgba(200,212,230,0.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(pnm)}</div></div></div>`
        + `<label style="${lb}">Note</label><input data-foot-field="note" value="${esc(selF.note||'')}" placeholder="e.g. needs rebar inspection" style="${inp}">`
        + (()=>{ const tmix=mixFor(selF.type); const lib=(typeof window.getMixDesigns==='function')?window.getMixDesigns():{}; const mo=tmix?lib[tmix]:null; const mixTxt=mo?(mo.label||tmix):(tmix||'Not set');
            const cnt=footings.filter(x=>!x.del&&x.type===selF.type).length;
            const ov=_footEdits&&_footEdits[selF.no]; const hasOv=!!(ov&&(ov.wFt!=null||ov.lFt!=null||ov.thk!=null||ov.beam!=null));
            return `<div style="margin-top:10px;padding:9px 10px;border-radius:9px;background:rgba(167,139,250,0.07);border:1px solid rgba(167,139,250,0.22)"><div style="display:flex;align-items:center;justify-content:space-between;gap:6px"><span style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#c4b5fd">Type ${esc(selF.type)} · ${cnt} on map</span><button data-edit-type="${esc(selF.type)}" style="font-size:10px;font-weight:700;color:#c4b5fd;background:none;border:none;cursor:pointer;font-family:Inter;text-decoration:underline">Edit type</button></div>`
              + `<div style="font-size:10.5px;color:rgba(200,212,230,0.6);margin-top:4px">Default mix: <span style="color:#7dd3fc;font-weight:600">${esc(mixTxt)}</span></div>`
              + `<button data-select-type="${esc(selF.type)}" style="width:100%;margin-top:7px;border:1px solid rgba(82,230,224,0.35);background:rgba(82,230,224,0.1);color:#7df0ec;border-radius:7px;padding:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter">Select all ${esc(selF.type)} (${cnt})</button>`
              + (hasOv ? `<button data-foot-reset="${selF.no}" title="Drop this footing's manual size and follow the ${esc(selF.type)} type defaults" style="width:100%;margin-top:6px;border:1px solid rgba(167,139,250,0.4);background:rgba(167,139,250,0.12);color:#c4b5fd;border-radius:7px;padding:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter">Reset to ${esc(selF.type)} defaults</button>` : '')
              + `</div>`; })()
        + `<div style="display:flex;gap:6px;margin-top:10px"><button data-foot-rot="1" title="Rotate 90° — swap width & length (R)" style="flex:1;border:1px solid rgba(167,139,250,0.4);background:rgba(167,139,250,0.12);color:#c4b5fd;border-radius:8px;padding:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle">rotate_90_degrees_cw</span> Rotate</button><button data-foot-dup="${selF.no}" style="flex:1;border:1px solid rgba(150,170,205,0.18);background:rgba(255,255,255,0.03);color:#cdd6e6;border-radius:8px;padding:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter">Duplicate</button><button data-foot-del="${selF.no}" style="flex:1;border:1px solid rgba(248,113,113,0.35);background:rgba(248,113,113,0.08);color:#fca5a5;border-radius:8px;padding:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter">Delete</button></div>`
        + `<div style="font-size:9.5px;color:rgba(170,188,218,0.4);margin-top:7px;line-height:1.4">${_locked?'Map is locked — unlock (toolbar) to drag this footing.':'Drag the footing on the map to move it.'} Ctrl+C/V copy · Ctrl+Z undo.</div>`
        + `</div>`;
    } else if(selP){
      const mem=members(selP.id), cy=pourCY(selP.id);
      const grp={}; mem.forEach(f=>{ const k=f.type; if(!grp[k])grp[k]={type:k,count:0,cy:0}; grp[k].count++; grp[k].cy+=f.cyv; });
      const rows=Object.values(grp).sort((a,b)=>b.cy-a.cy); const maxcy=Math.max(1,...rows.map(r=>r.cy));
      const [sl,scol]=stat[selP.status]; const active=S.mode==='assign';
      // normalize hex or rgb() to an 'R,G,B' string so we can ring the pour's current swatch
      const _normCol=s=>{ s=String(s||'').trim(); let m=/^#?([0-9a-fA-F]{6})$/.exec(s); if(m){ const n=parseInt(m[1],16); return ((n>>16)&255)+','+((n>>8)&255)+','+(n&255); } m=/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(s); if(m) return m[1]+','+m[2]+','+m[3]; return s; };
      const _curColCsv=_normCol(selP.color);
      html += `<div style="padding:16px 16px 14px;border-bottom:1px solid rgba(150,170,205,0.08)">`
        + `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px"><span style="font-size:9px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:rgba(170,188,218,0.42)">Selected Pour</span><span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;color:${scol};background:${hex2rgba(scol,0.14)};border:1px solid ${hex2rgba(scol,0.35)}">${sl}</span></div>`
        + `<div style="display:flex;align-items:center;gap:9px;margin-bottom:14px"><span style="width:14px;height:14px;border-radius:4px;background:${selP.color};box-shadow:0 0 10px ${hex2rgba(selP.color,0.6)}"></span><div><div style="font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:16px;color:#fff;line-height:1.1">${esc(selP.name)}</div><div style="font-size:11px;color:rgba(170,188,218,0.5);font-family:'JetBrains Mono',monospace;margin-top:2px">${selP.seq==='0.5'?'Sequence 0.5':'Sequence '+selP.seq}</div></div></div>`
        + `<div style="display:flex;gap:10px;margin-bottom:13px"><div style="flex:1;padding:10px 12px;border-radius:11px;background:rgba(0,0,0,0.3);border:1px solid rgba(150,170,205,0.10)"><div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:24px;color:#fff;letter-spacing:-0.02em;line-height:1">${fmt(cy)}</div><div style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(170,188,218,0.45);margin-top:3px">Cubic yards</div></div><div style="flex:1;padding:10px 12px;border-radius:11px;background:rgba(0,0,0,0.3);border:1px solid rgba(150,170,205,0.10)"><div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:24px;color:#fff;letter-spacing:-0.02em;line-height:1">${mem.length}</div><div style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(170,188,218,0.45);margin-top:3px">Footings</div></div></div>`
        + `<button data-act="assign-toggle" style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid ${active?'rgba(82,230,224,0.5)':'rgba(82,230,224,0.4)'};background:${active?'rgba(82,230,224,0.18)':'rgba(82,230,224,0.1)'};color:#7df0ec;border-radius:10px;padding:10px;font-size:12px;font-weight:700;cursor:pointer;font-family:Inter"><span class="material-symbols-outlined" style="font-size:16px">${active?'check':'edit'}</span>${active?'Done — finish editing area':'Edit area — add / remove footings'}</button>`
        + `<div style="font-size:10px;color:rgba(170,188,218,0.45);margin-top:8px;line-height:1.45">${active?'Editing “'+esc(selP.name)+'” — drag a box over footings to add them, or tap a footing to toggle it in/out. The footings recolor to match.':'The pour’s area is the footings assigned to it. Tap above, then drag over footings on the map to set its footprint.'}</div>`
        + `<div style="display:flex;gap:6px;margin-top:9px"><button data-rename="${selP.id}" style="flex:1;border:1px solid rgba(150,170,205,0.18);background:rgba(255,255,255,0.03);color:#cdd6e6;border-radius:8px;padding:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter">Rename</button><button data-delpour="${selP.id}" style="flex:1;border:1px solid rgba(248,113,113,0.35);background:rgba(248,113,113,0.08);color:#fca5a5;border-radius:8px;padding:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter">Delete</button></div>`
        + `<div style="margin-top:10px"><div style="font-size:9px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:rgba(170,188,218,0.42);margin-bottom:5px">Category</div><div style="display:flex;gap:2px;padding:2px;border-radius:9px;background:rgba(0,0,0,0.35);border:1px solid rgba(150,170,205,0.10)">`
          + `<button data-set-cat="foundation" style="flex:1;border:none;cursor:pointer;border-radius:7px;padding:6px 8px;font-size:11px;font-weight:700;font-family:Inter;transition:all .15s;${selP.category!=='ratslab'?'background:rgba(82,230,224,0.16);color:#7df0ec;box-shadow:inset 0 0 0 1px rgba(82,230,224,0.4)':'background:transparent;color:rgba(200,212,230,0.55)'}">Foundation</button>`
          + `<button data-set-cat="ratslab" style="flex:1;border:none;cursor:pointer;border-radius:7px;padding:6px 8px;font-size:11px;font-weight:700;font-family:Inter;transition:all .15s;${selP.category==='ratslab'?'background:rgba(244,114,182,0.16);color:#f9a8d4;box-shadow:inset 0 0 0 1px rgba(244,114,182,0.4)':'background:transparent;color:rgba(200,212,230,0.55)'}">Rat slab</button>`
          + `</div></div>`
        + `<div style="font-size:9px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:rgba(170,188,218,0.42);margin:12px 0 6px">Pour color</div>`
        + `<div style="display:flex;flex-wrap:wrap;gap:5px">` + FND_POUR_SWATCHES.map(c=>{ const on=_normCol(c)===_curColCsv; return `<button data-pour-color="${c}" title="${c}" style="width:20px;height:20px;border-radius:5px;cursor:pointer;padding:0;background:${c};border:2px solid ${on?'#fff':'transparent'};box-shadow:0 0 0 1px rgba(0,0,0,0.4)"></button>`; }).join('') + `</div>`
        + `<div style="font-size:9.5px;color:rgba(170,188,218,0.38);margin-top:6px">Recolors just this pour (switches the map to Sequence coloring). Property colors (Pilecap / footing) are left out on purpose.</div>`
        + `<div style="font-size:9px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:rgba(170,188,218,0.42);margin:16px 0 8px">Takeoff by type</div><div style="display:flex;flex-direction:column;gap:5px">`
        + rows.map(r=>`<div style="display:flex;align-items:center;gap:9px"><span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:#cdd6e6;min-width:62px">${esc(r.type)}</span><span style="font-size:10px;color:rgba(170,188,218,0.5);min-width:26px">×${r.count}</span><div style="flex:1;height:6px;border-radius:6px;background:rgba(255,255,255,0.05);overflow:hidden"><div style="height:100%;width:${Math.round(r.cy/maxcy*100)}%;border-radius:6px;background:${selP.color};opacity:0.8"></div></div><span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#cdd6e6;min-width:48px;text-align:right">${r.cy.toFixed(1)}</span></div>`).join('')
        + `</div></div>`;
    } else {
      let totCy=0,unassigned=0; footings.forEach(f=>{ if(f.del)return; totCy+=f.cyv; if(!f.pourId)unassigned++; });
      html += `<div style="padding:16px;border-bottom:1px solid rgba(150,170,205,0.08)"><div style="font-size:9px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:rgba(170,188,218,0.42);margin-bottom:10px">Project Takeoff</div><div style="display:flex;gap:10px;flex-wrap:wrap"><div style="flex:1;min-width:84px;padding:11px 12px;border-radius:11px;background:rgba(0,0,0,0.3);border:1px solid rgba(150,170,205,0.10)"><div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:23px;color:#fff;letter-spacing:-0.02em;line-height:1">${fmt(totCy)}</div><div style="font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:rgba(170,188,218,0.45);margin-top:3px">Total CY</div></div><div style="flex:1;min-width:84px;padding:11px 12px;border-radius:11px;background:rgba(0,0,0,0.3);border:1px solid rgba(150,170,205,0.10)"><div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:23px;color:#fff;letter-spacing:-0.02em;line-height:1">${footings.length}</div><div style="font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:rgba(170,188,218,0.45);margin-top:3px">Footings</div></div></div><div style="font-size:11px;color:rgba(170,188,218,0.5);margin-top:12px;line-height:1.5">${pours.length} pours · <span style="color:#fbbf24">${unassigned}</span> footings unassigned. Tap a pour to inspect; hit <b style="color:#cdd6e6">Assign</b> to refine its footings.</div></div>`;
    }
    const _listPours = pours.filter(p=>!(st.hideComplete && p.status==='complete') && !(st.hideRatslab && p.category==='ratslab'));
    const _hiddenN = pours.length - _listPours.length;
    html += `<div style="padding:12px 12px 18px"><div style="display:flex;align-items:center;justify-content:space-between;margin:4px 4px 9px"><span style="font-size:9px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:rgba(170,188,218,0.42)">Pours</span>${_hiddenN?`<span style="font-size:9px;color:rgba(170,188,218,0.4)">${_hiddenN} hidden</span>`:''}</div><div style="display:flex;flex-direction:column;gap:6px">`;
    html += _listPours.map(p=>{
      const cy=pourCY(p.id), cnt=members(p.id).length, isSel=p.id===S.selId; const [sl,scol]=stat[p.status];
      const isRat=p.category==='ratslab'; const dotc=isRat?'#f472b6':p.color;
      const ratTag=isRat?`<span style="font-size:8px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#f9a8d4;background:rgba(244,114,182,0.14);border:1px solid rgba(244,114,182,0.4);border-radius:5px;padding:1px 5px;margin-left:6px">Rat slab</span>`:'';
      return `<button data-pour="${p.id}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid ${isSel?hex2rgba(dotc,0.5):'rgba(150,170,205,0.08)'};background:${isSel?hex2rgba(dotc,0.08):'rgba(255,255,255,0.018)'};border-radius:11px;padding:9px 11px;cursor:pointer;font-family:Inter"><span style="width:11px;height:11px;border-radius:3px;flex:0 0 auto;background:${dotc};box-shadow:0 0 8px ${hex2rgba(dotc,0.5)}"></span><div style="flex:1;min-width:0;text-align:left"><div style="font-size:12.5px;font-weight:600;color:#eef2f8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}${ratTag}</div><div style="font-size:10px;color:rgba(170,188,218,0.46);font-family:'JetBrains Mono',monospace;margin-top:1px">${isRat?'Rat slab':(p.seq==='0.5'?'Seq 0.5':'Seq '+p.seq)} · ${cnt} ftg</div></div><div style="text-align:right"><div style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:#fff">${fmt(cy)}</div><div style="font-size:9px;color:${scol};font-weight:700;text-transform:uppercase;letter-spacing:0.04em">${sl}</div></div></button>`;
    }).join('');
    html += `</div></div>`;
    panelHost.innerHTML=html;
  }

  // ───────── DOM build / mount ─────────
  function buildDOM(){
    root=document.createElement('div');
    root.style.cssText='display:flex;flex-direction:column;width:100%;height:100%;background:#06060e;color:#e4e1e8;font-family:Inter,sans-serif;overflow:hidden;position:relative';
    root.innerHTML = `
      <div data-fm="toolbar" style="display:flex;align-items:center;gap:10px;flex:0 0 auto;padding:8px 12px;background:rgba(10,12,20,0.92);border-bottom:1px solid rgba(150,170,205,0.10);flex-wrap:wrap">
        <span style="font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14px;color:#fff">Foundation Map</span>
        <span data-fm="headline" style="font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(170,188,218,0.42)"></span>
        <div style="width:1px;height:22px;background:rgba(150,170,205,0.14)"></div>
        <div style="display:flex;gap:2px;padding:2px;border-radius:9px;background:rgba(0,0,0,0.35);border:1px solid rgba(150,170,205,0.10)"><button data-fm="modeExplore" title="Select (V) — click a footing to edit it, drag a box to select many, click a pour to inspect. Works locked.">Select</button><button data-fm="modeFooting" title="Move (M) — drag footings to reposition them.">Move</button><button data-fm="modeAssign" title="Assign (B) — pick a pour, then drag over footings to add them to it.">Assign</button></div>
        <div style="display:flex;align-items:center;gap:6px"><span style="font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(170,188,218,0.4)">Color</span><div style="display:flex;gap:2px;padding:2px;border-radius:9px;background:rgba(0,0,0,0.35);border:1px solid rgba(150,170,205,0.10)"><button data-fm="colorStatus">Status</button><button data-fm="colorSeq">Sequence</button></div></div>
        <button data-fm="typesBtn" title="Edit footing types — set default size + mix per type; changes update the whole map" style="display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(167,139,250,0.45);background:rgba(167,139,250,0.14);color:#c4b5fd;border-radius:8px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter"><span class="material-symbols-outlined" style="font-size:15px;line-height:1">category</span>Types</button>
        <button data-fm="selectAllBtn" title="Select every footing (Ctrl+A)" style="display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(150,170,205,0.2);background:rgba(255,255,255,0.03);color:rgba(200,212,230,0.7);border-radius:8px;padding:6px 11px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter"><span class="material-symbols-outlined" style="font-size:15px;line-height:1">select_all</span>Select all</button>
        <div style="flex:1"></div>
        <input data-fm="search" placeholder="Search footing # or type…" style="width:190px;background:rgba(8,11,18,0.8);border:1px solid rgba(150,170,205,0.14);border-radius:9px;padding:7px 11px;color:#fff;font-size:12px;font-family:'JetBrains Mono',monospace;outline:none" />
        <div style="display:flex;align-items:center;gap:2px;padding:2px;border-radius:9px;background:rgba(0,0,0,0.35);border:1px solid rgba(150,170,205,0.10)"><button data-fm="zoomOut" style="width:30px;height:28px;border:none;background:transparent;color:rgba(220,230,245,0.7);font-size:17px;cursor:pointer;border-radius:7px">−</button><button data-fm="zoomFit" style="min-width:50px;height:28px;border:none;background:transparent;color:rgba(220,230,245,0.7);font-size:11px;font-weight:700;font-family:'JetBrains Mono',monospace;cursor:pointer;border-radius:7px">100%</button><button data-fm="zoomIn" style="width:30px;height:28px;border:none;background:transparent;color:rgba(220,230,245,0.7);font-size:17px;cursor:pointer;border-radius:7px">+</button></div>
      </div>
      <div data-fm="toolsrow" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:0 0 auto;padding:6px 12px;background:rgba(9,11,18,0.9);border-bottom:1px solid rgba(150,170,205,0.08)">
        <span style="font-size:9px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:rgba(170,188,218,0.4)">Markup</span>
        <div style="display:flex;gap:2px;padding:2px;border-radius:9px;background:rgba(0,0,0,0.35);border:1px solid rgba(150,170,205,0.10)"><button data-tool="region" title="Draw a highlighted region">Highlight</button><button data-tool="polyline" title="Draw a line">Polyline</button><button data-tool="text" title="Place a text label">Text</button><button data-tool="markselect" title="Edit a markup — move it, drag corner handles to resize, Delete to remove">Edit markup</button></div>
        <div data-fm="swatches" style="display:flex;align-items:center;gap:4px"></div>
        <div style="flex:1"></div>
        <button data-fm="addfootBtn" title="Add a footing — pick a type, then click on the map to place it (R rotates)" style="border:1px solid rgba(167,139,250,0.45);background:rgba(167,139,250,0.14);color:#c4b5fd;border-radius:8px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter">+ Footing</button>
        <button data-fm="newpour" style="border:1px solid rgba(82,230,224,0.4);background:rgba(82,230,224,0.12);color:#7df0ec;border-radius:8px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter">+ New pour</button>
        <button data-fm="delmark" style="border:1px solid rgba(248,113,113,0.4);background:rgba(248,113,113,0.1);color:#fca5a5;border-radius:8px;padding:6px 11px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter">Delete</button>
        <button data-fm="clearmark" style="border:1px solid rgba(150,170,205,0.18);background:rgba(255,255,255,0.03);color:rgba(200,212,230,0.6);border-radius:8px;padding:6px 11px;font-size:11px;font-weight:700;cursor:pointer;font-family:Inter">Clear marks</button>
      </div>
      <div data-fm="subbar" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;flex:0 0 auto;padding:6px 12px;background:rgba(8,10,16,0.85);border-bottom:1px solid rgba(150,170,205,0.08)">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:9px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:rgba(170,188,218,0.45)">Sequence</span><div data-fm="chips" style="display:flex;gap:6px;flex-wrap:wrap"></div></div>
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <button data-fm="markDone" title="Mark footings complete — tap a footing on the map to toggle it done (solid green)"><span class="material-symbols-outlined" data-ic style="font-size:15px;line-height:1">task_alt</span><span data-lbl>Mark done</span></button>
          <button data-fm="exportStatus" title="Export the footing map status — printable report / save as PDF"><span class="material-symbols-outlined" style="font-size:15px;line-height:1">picture_as_pdf</span><span data-lbl>Export status</span></button>
          <button data-fm="hideComplete" title="Hide completed pours so the map isn't congested"><span class="material-symbols-outlined" data-ic style="font-size:15px;line-height:1">visibility</span><span data-lbl>Hide complete</span></button>
          <button data-fm="showNames" title="Show each pour's name and number on the map"><span class="material-symbols-outlined" data-ic style="font-size:15px;line-height:1">label</span><span data-lbl>Names</span></button>
          <button data-fm="showDates" title="Show each pour's date on the map (instead of its name)"><span class="material-symbols-outlined" data-ic style="font-size:15px;line-height:1">event</span><span data-lbl>Dates</span></button>
          <button data-fm="hideRatslab" title="Hide rat slab pours so the map isn't congested"><span class="material-symbols-outlined" data-ic style="font-size:15px;line-height:1">grid_on</span><span data-lbl>Rat slabs</span></button>
          <div style="width:1px;height:18px;background:rgba(150,170,205,0.14)"></div>
          <div style="display:flex;align-items:center;gap:6px"><span style="width:9px;height:9px;border-radius:2px;background:#f472b6"></span><span style="font-size:10px;color:rgba(200,212,230,0.6)">Rat&nbsp;slab</span></div>
          <div style="display:flex;align-items:center;gap:6px"><span style="width:9px;height:9px;border-radius:2px;background:#34d399"></span><span style="font-size:10px;color:rgba(200,212,230,0.6)">Complete</span></div>
          <div style="display:flex;align-items:center;gap:6px"><span style="width:9px;height:9px;border-radius:2px;background:#fbbf24"></span><span style="font-size:10px;color:rgba(200,212,230,0.6)">In&nbsp;progress</span></div>
          <div style="display:flex;align-items:center;gap:6px"><span style="width:9px;height:9px;border-radius:2px;background:#38bdf8"></span><span style="font-size:10px;color:rgba(200,212,230,0.6)">Scheduled</span></div>
          <div style="display:flex;align-items:center;gap:6px"><span style="width:9px;height:9px;border-radius:2px;background:#64748b"></span><span style="font-size:10px;color:rgba(200,212,230,0.6)">Unassigned</span></div>
        </div>
      </div>
      <div style="display:flex;flex:1;min-height:0">
        <div data-fm="mapArea" style="position:relative;flex:1;min-width:0;background:radial-gradient(ellipse at 42% 36%,#141b27 0%,#0d1119 60%,#08090f 100%);overflow:hidden;cursor:default;touch-action:none">
          <canvas data-fm="canvas" style="display:block;width:100%;height:100%"></canvas>
          <div data-fm="tip" style="position:absolute;left:0;top:0;display:none;pointer-events:none;z-index:6;background:rgba(8,11,18,0.96);border:1px solid rgba(150,170,205,0.18);border-radius:9px;padding:8px 11px;box-shadow:0 14px 36px rgba(0,0,0,0.55);min-width:140px"></div>
          <div data-fm="hintbar" style="position:absolute;left:14px;bottom:14px;z-index:6;display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:9px;background:rgba(8,11,18,0.78);border:1px solid rgba(150,170,205,0.12);max-width:440px"><span style="width:7px;height:7px;border-radius:50%;background:#52E6E0"></span><span data-fm="hint" style="font-size:11px;color:rgba(210,222,240,0.72);line-height:1.4"></span></div>
          <div data-fm="compass" style="position:absolute;right:16px;top:14px;z-index:6;text-align:center;opacity:0.5;pointer-events:none"><div style="font-size:15px;line-height:1;color:rgba(170,188,218,0.8)">▲</div><div style="font-size:10px;font-weight:700;font-family:'JetBrains Mono',monospace;color:rgba(170,188,218,0.7)">N</div></div>
        </div>
        <div data-fm="panel" style="flex:0 0 332px;width:332px;background:rgba(9,11,18,0.92);border-left:1px solid rgba(150,170,205,0.10);overflow-y:auto;display:none"></div>
      </div>`;
    const q=s=>root.querySelector(`[data-fm="${s}"]`);
    mapArea=q('mapArea'); canvas=q('canvas'); tip=q('tip'); panelHost=q('panel');
    searchEl=q('search'); zoomLabelEl=q('zoomFit'); elChips=q('chips');
    elModeExplore=q('modeExplore'); elModeAssign=q('modeAssign'); elColorStatus=q('colorStatus'); elColorSeq=q('colorSeq');
    modeHintEl=q('hint'); headlineEl=q('headline');
    toolbarEl=q('toolbar'); subbarEl=q('subbar'); hintBarEl=q('hintbar'); toolsRowEl=q('toolsrow'); swatchesEl=q('swatches');
    [elModeExplore,elModeAssign,elColorStatus,elColorSeq].forEach(b=>b.setAttribute('style',btnStyle(false)));
    { const _hc=root.querySelector('[data-fm="hideComplete"]'); if(_hc) _hc.setAttribute('style', hideCompleteStyle(st.hideComplete)); }
    { const _md=root.querySelector('[data-fm="markDone"]'); if(_md){ _md.setAttribute('style', hideCompleteStyle(false)); if((window.location.search||'').indexOf('view=manager')>=0) _md.style.display='none'; } }
    { const _ex=root.querySelector('[data-fm="exportStatus"]'); if(_ex) _ex.setAttribute('style', hideCompleteStyle(false)); }
    { const _sn=root.querySelector('[data-fm="showNames"]'); if(_sn) _sn.setAttribute('style', hideCompleteStyle(st.showNames)); }
    { const _sd=root.querySelector('[data-fm="showDates"]'); if(_sd) _sd.setAttribute('style', hideCompleteStyle(st.showDates)); }
    { const _rs=root.querySelector('[data-fm="hideRatslab"]'); if(_rs) _rs.setAttribute('style', hideCompleteStyle(st.hideRatslab)+';display:none'); }
    elModeExplore.onclick=()=>setTool('select');
    elModeAssign.onclick=()=>setTool('assign');
    q('modeFooting').onclick=()=>setTool('move');
    q('typesBtn').onclick=()=>{ if(typeof window.showFootingTypesModal==='function') window.showFootingTypesModal(); };
    q('selectAllBtn').onclick=()=>selectAllFootings();
    elColorStatus.onclick=()=>setColorMode('status');
    elColorSeq.onclick=()=>setColorMode('sequence');
    q('zoomOut').onclick=()=>zoomAt(cssW/2,cssH/2,1/1.3);
    q('zoomIn').onclick=()=>zoomAt(cssW/2,cssH/2,1.3);
    q('zoomFit').onclick=()=>{ _fitted=true; fit(); };
    searchEl.addEventListener('input', e=>doSearch(e.target.value));
    elChips.addEventListener('click', e=>{ const b=e.target.closest('[data-filter]'); if(b) setFilter(b.getAttribute('data-filter')); });
    q('markDone').onclick=()=>{ const on=st.tool!=='markdone'; setTool(on?'markdone':'select'); if(on) fxModeEntry(q('markDone')); };
    q('exportStatus').onclick=()=>{ if(typeof window.exportFootingMapStatus==='function') window.exportFootingMapStatus(); };
    q('hideComplete').onclick=()=>toggleHideComplete();
    q('showNames').onclick=()=>toggleShowNames();
    q('showDates').onclick=()=>toggleShowDates();
    q('hideRatslab').onclick=()=>toggleHideRatslab();
    toolsRowEl.addEventListener('click', e=>{ const b=e.target.closest('[data-tool]'); if(b){ const t=b.getAttribute('data-tool'); setTool(st.tool===t?'explore':t); } });
    swatchesEl.addEventListener('click', e=>{ const b=e.target.closest('[data-sw]'); if(b) setMarkColor(b.getAttribute('data-sw')); });
    q('addfootBtn').onclick=()=>{ if(st.tool==='addfoot') setTool('explore'); else armAddFooting(_lastAddType); };   // picker lives in the right panel
    q('newpour').onclick=()=>{ if(typeof showAddFoundationPourModal==='function') showAddFoundationPourModal(); };
    q('delmark').onclick=()=>{ if(selMarkupId) deleteMarkup(selMarkupId); };
    q('clearmark').onclick=()=>{ if(markups.length && (typeof confirm!=='function'||confirm('Clear all '+markups.length+' markup(s)?'))) clearMarkups(); };
    panelHost.addEventListener('click', e=>{
      const at=e.target.closest('[data-add-type]'); if(at){ setAddType(at.getAttribute('data-add-type')); return; }
      const as=e.target.closest('[data-add-stop]'); if(as){ setTool('explore'); return; }
      const pb=e.target.closest('[data-pour]'); if(pb){ selectPourId(pb.getAttribute('data-pour')); return; }
      const rn=e.target.closest('[data-rename]'); if(rn){ if(typeof promptPourName==='function') promptPourName(rn.getAttribute('data-rename')); return; }
      const dl=e.target.closest('[data-delpour]'); if(dl){ if(typeof deleteFoundationPour==='function') deleteFoundationPour(dl.getAttribute('data-delpour')); return; }
      const sc3=e.target.closest('[data-set-cat]'); if(sc3){ if(typeof setFoundationPourCategory==='function') setFoundationPourCategory(st.selId, sc3.getAttribute('data-set-cat')); return; }
      const pc=e.target.closest('[data-pour-color]'); if(pc){ const hx=pc.getAttribute('data-pour-color'); if(st.selId && typeof setFoundationPourColor==='function'){ setFoundationPourColor(st.selId, _fmHexToRgbCsv(hx)); setColorMode('sequence'); try{ const fm=getFoundationMap(); fm.setPours(foundationPours); fm.selectPour(st.selId); }catch(_){} } return; }   // per-pour color only paints the cells in Sequence coloring — switch to it so the change shows
      const ap=e.target.closest('[data-assign-pour]'); if(ap){ assignSelectedToPour(ap.getAttribute('data-assign-pour')||null); return; }
      const cs=e.target.closest('[data-clear-sel]'); if(cs){ selFootings=new Set(); selFootingNo=null; renderPanel(); scheduleDraw(); return; }
      const st2=e.target.closest('[data-select-type]'); if(st2){ selectType(st2.getAttribute('data-select-type')); return; }
      const et=e.target.closest('[data-edit-type]'); if(et){ if(typeof window.showFootingTypesModal==='function') window.showFootingTypesModal(et.getAttribute('data-edit-type')); return; }
      const fdup=e.target.closest('[data-foot-dup]'); if(fdup){ const f=byNo[+fdup.getAttribute('data-foot-dup')]; if(f) addFooting({type:f.type,wFt:f.wFt,lFt:f.lFt,thk:f.thk,note:f.note,cx:f.cx+22,cy:f.cy+22}); return; }
      const fdel=e.target.closest('[data-foot-del]'); if(fdel){ deleteFooting(+fdel.getAttribute('data-foot-del')); return; }
      const frst=e.target.closest('[data-foot-reset]'); if(frst){ resetFootingToType(+frst.getAttribute('data-foot-reset')); return; }
      const frot=e.target.closest('[data-foot-rot]'); if(frot){ rotateSelection(); return; }
      const rsel=e.target.closest('[data-rotate-sel]'); if(rsel){ rotateSelection(); return; }
      const mds=e.target.closest('[data-mark-done-sel]'); if(mds){ markSelectionDone(true); return; }
      const cds=e.target.closest('[data-clear-done-sel]'); if(cds){ markSelectionDone(false); return; }
      const sdn=e.target.closest('[data-foot-setdone]'); if(sdn){ setFootingDoneByNo(+sdn.getAttribute('data-foot-no'), sdn.getAttribute('data-foot-setdone')==='1'); return; }
      const ab=e.target.closest('[data-act]'); if(ab && ab.getAttribute('data-act')==='assign-toggle'){ setTool(st.mode==='assign'?'explore':'assign'); }
    });
    panelHost.addEventListener('change', e=>{
      const fld=e.target.closest('[data-foot-field]'); if(fld && selFootingNo!=null){ const k=fld.getAttribute('data-foot-field'); if(k==='note') setFootingNote(selFootingNo, fld.value); else editFooting(selFootingNo, k, fld.value); return; }
      const blk=e.target.closest('[data-bulk-field]'); if(blk && fld!==blk){ setSelectionDim(blk.getAttribute('data-bulk-field'), blk.value); return; }
    });
    // live filter for the add-footing type picker (in-place row hide → keeps input focus)
    panelHost.addEventListener('input', e=>{ const fi=e.target.closest('[data-add-filter]'); if(!fi) return;
      _addFilter=fi.value; const q=_addFilter.trim().toLowerCase();
      panelHost.querySelectorAll('[data-add-row]').forEach(r=>{ const t=r.getAttribute('data-add-row').toLowerCase(); r.style.display=(!q||t.indexOf(q)>=0)?'':'none'; }); });
    _ro=new ResizeObserver(()=>resize()); _ro.observe(mapArea);
    _built=true;
  }
  function ensureBuilt(){ if(!_built) buildDOM(); }
  // 'minimal' (Sequences card → just the map, tight fit, general idea) vs 'full' (Footing tab → immersive)
  function applyChrome(mode){
    const full = mode!=='minimal';
    if(toolbarEl) toolbarEl.style.display = full?'flex':'none';
    if(toolsRowEl) toolsRowEl.style.display = full?'flex':'none';
    if(subbarEl) subbarEl.style.display = full?'flex':'none';
    if(hintBarEl) hintBarEl.style.display = full?'flex':'none';
    const compass=root&&root.querySelector('[data-fm="compass"]'); if(compass) compass.style.display = full?'block':'none';   // in the compact preview the Hide-complete toggle takes this top-right corner
    _fitMargin = full?46:18;
    _typeColor = !full;   // minimal preview = color footings by type (lively); full tab = grey unassigned (shows assign progress)
  }
  // ───────── per-footing complete status (shared footings/fnd{no} store) ─────────
  function setFootingStatus(obj){ _footStatus=obj||{}; syncChrome(); scheduleDraw(); }
  function onFootingToggle(cb){ _footToggleCb=cb; }
  function onBulkDone(cb){ _bulkDoneCb=cb; }
  // Set one footing's complete state from the side panel (mark complete OR undo a wrong mark).
  function setFootingDoneByNo(no, done){
    const f=byNo[no]; if(!f||f.del) return;
    _footStatus['fnd'+no]=done?'DONE':'';
    startPulse(f,done); popCheck(f,done); syncChrome(); scheduleDraw(); renderPanel();
    if(_footToggleCb){ try{ _footToggleCb(no, done); }catch(e){ console.error('footing set done', e); } }
  }
  // Bulk mark the current multi-selection complete (or clear). Persists via one batched
  // callback (single Firebase update + feed entry), with staggered pulse rings for feedback.
  function markSelectionDone(done){
    const nos=[...selFootings].filter(no=>byNo[no] && !byNo[no].del);
    if(!nos.length) return;
    nos.forEach(no=>{ _footStatus['fnd'+no]=done?'DONE':''; });   // optimistic — callback confirms + persists
    nos.slice(0,80).forEach((no,i)=>{ const f=byNo[no]; if(f) setTimeout(()=>startPulse(f,done), Math.min(i*16,640)); });
    syncChrome(); scheduleDraw(); renderPanel();
    if(_bulkDoneCb){ try{ _bulkDoneCb(nos.map(n=>'fnd'+n), done); }catch(e){ console.error('bulk done', e); } }
  }
  // anime.js flourish when Mark-done mode is armed (guarded — works without the lib)
  function fxModeEntry(btn){ if(!window.anime||!btn) return;
    try{ window.anime({targets:btn, scale:[1,1.07,1], duration:420, easing:'easeOutBack'});
      if(subbarEl) window.anime({targets:subbarEl.querySelectorAll('[data-lbl]'), translateY:[-3,0], opacity:[0.5,1], delay:window.anime.stagger(35), duration:300, easing:'easeOutQuad'});
    }catch(e){} }
  // High-res offscreen render of the whole plan for the status report (no html2canvas —
  // temporarily swaps draw()'s ctx/viewport, renders, restores).
  function snapshot(opts){
    opts=opts||{}; if(!footings||!planW||!ctx) return null;
    const W=opts.width||2600, H=Math.round(W*planH/planW);
    const off=document.createElement('canvas'); off.width=W; off.height=H;
    const save={ctx,tx,ty,scale,cssW,cssH, hideC:st.hideComplete, hideRat:st.hideRatslab, filter:st.filter, selId:st.selId, showNames:st.showNames, showDates:st.showDates,
      selF:selFootings, selNo:selFootingNo, flash, pulses, selBand:_selBand, band, markBand:_markBand, introT:_introT,
      seqTool:st.seqTool, seqSel:_seqSelId, seqDraft:_seqDraft, seqLayer:_seqLayer, seqDay:_seqDay, seqMode:_seqMode, seq:_seq};
    try{
      ctx=off.getContext('2d');
      cssW=W/dpr; cssH=H/dpr;                                   // draw() multiplies by dpr — compensate
      const m=40/dpr, s=Math.min((cssW-m*2)/planW,(cssH-m*2)/planH);
      scale=s; tx=(cssW-planW*s)/2; ty=(cssH-planH*s)/2;
      st.hideComplete=false; st.hideRatslab=false; st.filter='ALL'; st.selId=null; st.showNames=opts.names!==false; st.showDates=false;
      selFootings=new Set(); selFootingNo=null; flash=null; pulses=[]; _selBand=null; band=null; _markBand=null; _introT=0;
      // Sequence overlay: opts.seq keeps it (optionally on a specific layer/date), otherwise
      // the export is the plain plan — exportFootingMapStatus must not sprout arrows.
      st.seqTool='none'; _seqSelId=null; _seqDraft=null;
      if(opts.seq){ if(opts.seqLayer) _seqLayer=opts.seqLayer; if(opts.seqDay!=null) _seqDay=(typeof opts.seqDay==='number')?opts.seqDay:_sdNum(opts.seqDay); if(opts.seqMode) _seqMode=opts.seqMode; }
      else { _seq=null; _seqDay=null; }
      draw();                                                    // draw() clears first, so composite onto dark after
      const fin=document.createElement('canvas'); fin.width=W; fin.height=H;
      const fc=fin.getContext('2d'); fc.fillStyle='#0d1119'; fc.fillRect(0,0,W,H); fc.drawImage(off,0,0);
      return fin.toDataURL('image/png');
    }catch(e){ console.error('foundation snapshot', e); return null; }
    finally{
      ctx=save.ctx; tx=save.tx; ty=save.ty; scale=save.scale; cssW=save.cssW; cssH=save.cssH;
      st.hideComplete=save.hideC; st.hideRatslab=save.hideRat; st.filter=save.filter; st.selId=save.selId; st.showNames=save.showNames; st.showDates=save.showDates;
      selFootings=save.selF; selFootingNo=save.selNo; flash=save.flash; pulses=save.pulses; _selBand=save.selBand; band=save.band; _markBand=save.markBand; _introT=save.introT;
      st.seqTool=save.seqTool; _seqSelId=save.seqSel; _seqDraft=save.seqDraft; _seqLayer=save.seqLayer; _seqDay=save.seqDay; _seqMode=save.seqMode; _seq=save.seq;
      scheduleDraw();
    }
  }
  // Per-pour complete/remaining rollup for the status report.
  function getStatusSummary(){
    const out={pours:[], unassigned:{name:'Unassigned',total:0,done:0,cy:0,cyDone:0}, totals:{total:0,done:0,cy:0,cyDone:0}};
    if(!footings) return out;
    const rows={};
    (pours||[]).forEach(p=>{ rows[p.id]={id:p.id,name:p.name,seq:p.seq,status:p.status,category:p.category,total:0,done:0,cy:0,cyDone:0}; });
    footings.forEach(f=>{ if(f.del) return; const d=isDone(f); const r=(f.pourId&&rows[f.pourId])?rows[f.pourId]:out.unassigned;
      r.total++; r.cy+=f.cyv||0; out.totals.total++; out.totals.cy+=f.cyv||0;
      if(d){ r.done++; r.cyDone+=f.cyv||0; out.totals.done++; out.totals.cyDone+=f.cyv||0; } });
    out.pours=(pours||[]).map(p=>rows[p.id]).sort((a,b)=>(parseFloat(a.seq)-parseFloat(b.seq))||String(a.name).localeCompare(String(b.name)));
    return out;
  }
  function mount(container, o){ ensureBuilt(); relocate(container, o); }
  function relocate(container, o){
    ensureBuilt(); o=o||{};
    _showPanel = (o.panel===true);
    if(panelHost) panelHost.style.display = _showPanel ? 'block' : 'none';
    applyChrome(o.chrome || (_showPanel ? 'full' : 'minimal'));
    if(container && root.parentNode!==container) container.appendChild(root);
    if(!ctx) setupCanvas();
    tryInit(); syncChrome(); renderPanel();
    _fitted=false;   // re-fit to the new container size
    kick();
  }

  return {
    mount, relocate, kick, resize, destroy(){ if(_ro)_ro.disconnect(); if(root&&root.parentNode)root.parentNode.removeChild(root); },
    setColorMode, setFilter, setMode, selectPour:selectPourId, search:doSearch,
    toggleHideComplete, setHideComplete, isHideComplete(){ return !!st.hideComplete; },
    toggleShowNames, setShowNames, isShowNames(){ return !!st.showNames; },
    toggleShowDates, setShowDates, isShowDates(){ return !!st.showDates; },
    toggleHideRatslab, setHideRatslab, isHideRatslab(){ return !!st.hideRatslab; }, hasRatslab,
    setMembership, getMembership, onMembershipChange(cb){ _membershipCb=cb; },
    setPours, clearPourMembership, getTakeoff, onTakeoffChange,
    setMarkups, getMarkups:getMarkupsObj, onMarkupChange,
    setFootingEdits, onFootingEditChange, setLocked,
    setTypeDefs, onTypeDefChange, getTypesSummary, setTypeProp, clearTypeDef,
    selectType, selectAllFootings, clearSelection, zoomToSelection, setSelectionDim,
    rotateSelection, armAddFooting, addFooting, getMixForType:mixFor,
    buildPourDayMap, members(pid){ return (members(pid)||[]).map(f=>f.no); },
    setFootingStatus, onFootingToggle, onBulkDone, markSelectionDone, setFootingDoneByNo, snapshot, getStatusSummary,
    setTool, setMarkColor, finishPolyline,
    deleteSelectedMarkup(){ if(selMarkupId) deleteMarkup(selMarkupId); }, clearMarkups,
    // ── sequence layer ──
    setSequence, getSequence, onSeqChange, onSeqZoneDrawn, onSeqSelect, onSeqTick, onSeqNotice,
    seqRemoveVertex, seqInsertVertex, seqVertexCount(id){ const ph=_seq&&_seq.phases&&_seq.phases[id]; return ph?((ph.poly||[]).length):0; },
    setSeqPlayhead, getSeqPlayhead, seqRange, setSeqLayer, setSeqMode,
    setSeqFilter, getSeqFilter, seqLetters,
    setSeqTool, setSeqRouteCrew, getSeqRouteCrew, finishSeqDraft, cancelSeqDraft, undoSeqDraftPoint,
    seqPlay, seqIsPlaying(){ return _seqPlaying; }, setSeqSpeed, setSeqStamp, setSeqLabels, seqLabelsOn,
    setSeqIcons, seqIconsOn, seqIconName,
    seqSelect, getSeqSelected, seqActs, seqGroups, getSeqStats,
    phaseFootings, hullFromSelection, pourHullNorm, listPours, planSize,
    hasSelection(){ return !!(selFootings && selFootings.size); },
    getState(){ return { mode:st.mode, tool:st.tool, seqTool:st.seqTool||'none', selId:st.selId, markColor:st.markColor, selMarkupId, markupCount:markups.length }; }
  };
}

  window.OYFoundationMap = {
    create: createFoundationMap,
    version: '1.1.0',
    // equipment icon set — shared with the host so panels and map never drift
    ICONS: SEQ_ICONS, ICON_LIST: SEQ_ICON_LIST, ACT_ICON: SEQ_ACT_ICON, iconSvg: seqIconSvg,
  };
})();
