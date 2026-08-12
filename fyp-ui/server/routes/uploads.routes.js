const express = require('express');
const { nextId } = require('../db');

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { dataUrl } = req.body;
    const storageKey = `upload-${nextId('uploads')}`;
    res.json({ storageKey, url: dataUrl });
  } catch (err) { next(err); }
});

module.exports = router;
