(function(){
  "use strict";
  const C = 2*Math.PI*108;            // ring circumference
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2,'0');

  const S = {
    mode:'setup', running:false,
    focusMin:25, breakMin:5, longRestMin:15,
    remaining:25*60, total:25*60,
    autoContinue:true, sound:true,
    sessionsToday:0, cycle:0, restIsLong:false,
    repeat:4, runCount:0,
    endAt:0, day:''
  };

  let loop=null, audio=null, wake=null;

