/** Gender subcategories inside every voting category. "other" is shown to users as "Others". */
const GENDERS = ['male', 'female', 'other'];
const GENDER_LABEL = { male: 'Male', female: 'Female', other: 'Others' };
const normalizeGender = (g) => (GENDERS.includes(String(g || '').toLowerCase()) ? String(g).toLowerCase() : null);
/** Records created before subcategories existed have no gender; they are listed under "Others" until an admin sets one. */
const isGender = (g) => GENDERS.includes(g);
const genderOf = (c) => c?.gender || 'other';
module.exports = { GENDERS, GENDER_LABEL, isGender, normalizeGender, genderOf };
