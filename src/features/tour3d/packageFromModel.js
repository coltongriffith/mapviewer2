import {studioInput} from './studioInput';
import {buildTourPackage} from './build';

export function packageFromModel(snapshot,options={}) {
  const input=studioInput({...snapshot,envelopeSources:options.includeEnvelopes?snapshot.envelopeSources:[]});
  const pkg=buildTourPackage({...input,...options,grade:{...input.grade,...options.grade,displayCutoff:(!options.grade?.field||options.grade.field===input.grade.field)?input.grade.displayCutoff:null}});
  pkg.meta.warnings.unshift(...input.warnings);
  const equivalent=snapshot.appearance?.equivalent;
  if(equivalent&&(options.grade?.field||input.grade.field)===equivalent.field)pkg.meta.warnings.unshift(equivalent.note);
  return pkg;
}
