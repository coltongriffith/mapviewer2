// Read existing geometry and materials only. No interpolation or new envelope.
export function modelSnapshot({project,state,shell,shells=[],opacities=[],binColors=[],equivalentNote=null}) {
  const envelopeSources=[];
  for (const f of project?.meshF||[]) {
    const s=state.meshes?.[f.name];
    if (!s?.show) continue;
    envelopeSources.push({name:f.name,positions:f.mesh.v,indices:f.mesh.f,origin:[0,0,0],color:s.color,opacity:s.opacity,kind:'supplied'});
  }
  if (state.shell?.enabled && shell) shell.parts.forEach((p,i)=>{
    if (!p.indices.length) return;
    envelopeSources.push({name:shells[i]?.label||`Exploratory grade envelope · ${shells[i]?.cutoff} ${state.valueLabel||state.valueCol||''}`,positions:p.positions,indices:p.indices,origin:shell.origin,color:shells[i]?.color,opacity:opacities[i]??state.shell.opacity,kind:'estimated'});
  });
  return {envelopeSources,appearance:{gradeColors:[...binColors],traceColor:'#59646a',displayCutoff:state.displayCutoff,primary:state.primary,accent:state.accent,modelPlacement:true,equivalentNote},
    modelKey:JSON.stringify([state.valueCol,state.bins,state.displayCutoff,state.primary,state.accent,state.meshes,state.shell,state.collarFit,state.vex,shell?.key,project?.holes?.map(h=>[h.id,h.c?.z,h.path?.[0]?.z])])};
}
