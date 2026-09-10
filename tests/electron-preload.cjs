// Isolated test session: load only the production translation module.
const { startTranslation } = require('../app/code/renderer/modules/translation.js');
window.addEventListener('DOMContentLoaded', startTranslation);
