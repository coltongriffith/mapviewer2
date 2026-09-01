export const SNAP_THRESHOLD = 8;

export const EXPORT_RATIOS = {
  landscape: { id: 'landscape', label: 'Landscape', description: '16:9', ratio: 16 / 9, suggestedPdfSize: 'ppt_169' },
  square:    { id: 'square',    label: 'Square',    description: '1:1',  ratio: 1,       suggestedPdfSize: 'letter_landscape' },
  portrait:  { id: 'portrait',  label: 'Portrait',  description: '3:4',  ratio: 3 / 4,   suggestedPdfSize: 'letter_portrait' },
};
