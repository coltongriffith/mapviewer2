export function renderLayoutItems(scene) {
  return [
    '<g id="text-elements"></g>',
    '<g id="callouts"></g>',
    '<g id="title-block"></g>',
    '<g id="logo"></g>',
    '<g id="inset"></g>',
    '<g id="north-arrow"></g>',
  ].join('\n');
}
