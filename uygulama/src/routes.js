const express = require('express');
const { controllers } = require('./controllers');

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function requireLogin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Devam etmek için giriş yap.' });
  next();
}

function requireAdmin(req, res, next) {
  if (req.session?.user?.rol !== 'yonetici') {
    return res.status(403).json({ error: 'Bu işlem yalnızca yöneticilere açıktır.' });
  }
  next();
}

router.get('/health', controllers.health);
router.post('/auth/login', controllers.login);
router.post('/auth/logout', controllers.logout);
router.get('/auth/me', (req, res, next) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Oturum açılmamış.' });
  next();
}, controllers.me);

router.use(requireLogin);
router.get('/lookups', controllers.lookups);
router.get('/menus/today', controllers.todayMenus);
router.get('/menus/week', controllers.weekMenus);
router.get('/reservations', controllers.reservations);
router.post('/reservations', controllers.createReservation);
router.delete('/reservations/:id', controllers.cancelReservation);
router.get('/wallet', controllers.wallet);
router.post('/wallet/topups', controllers.topUp);
router.get('/ratings/eligible', controllers.eligibleRatings);
router.post('/ratings', controllers.saveRating);
router.get('/admin/menus', requireAdmin, controllers.adminMenus);
router.get('/admin/menus/:id', requireAdmin, controllers.adminMenu);
router.post('/admin/menus', requireAdmin, controllers.saveAdminMenu);

router.all('*', asyncRoute(async (_req, res) => {
  res.status(404).json({ error: 'API yolu bulunamadı.' });
}));

module.exports = router;
