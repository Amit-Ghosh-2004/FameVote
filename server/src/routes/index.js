const router = require('express').Router();

router.use('/auth', require('./auth'));
router.use('/admin', require('./admin'));
router.use('/', require('./public'));

module.exports = router;
