// Categorical palette slots 1-3 (blue/orange/aqua) from the dataviz skill's
// validated default palette — confirmed via validate_palette.js to pass all
// hard gates (all-pairs, both CVD and normal-vision) for exactly 3 series.
export const PRODUCT_COLORS = {
  signatera: { light: '#2a78d6', dark: '#3987e5', label: 'Signatera' },
  guardant360: { light: '#eb6834', dark: '#d95926', label: 'Guardant360' },
  foundationone_liquid: { light: '#1baf7a', dark: '#199e70', label: 'FoundationOne Liquid' },
};

export const AUTHOR_TYPE_LABELS = {
  patient: 'Patient',
  caregiver: 'Caregiver',
  doctor: 'Doctor',
  healthcare_professional: 'Healthcare professional',
  other: 'Other',
  unknown: 'Unknown',
};
