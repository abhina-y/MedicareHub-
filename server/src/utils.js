export const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
export const asMinutes = (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
export const timeFromMinutes = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
export const dateDay = (value) => days[new Date(`${value}T00:00:00`).getDay()];
export const localIsoDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const isFutureDate = (value) => value > localIsoDate();
export const newId = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
