const { getDb } = require('../config/db');
const { publicDataCache } = require('../utils/memoryCache');

const SITE_CONFIG_CACHE_KEY = 'site-config:public';
const PUBLIC_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';

const DEFAULT_CONFIG = {
  heroBackgroundUrl: '',
  announcementBanner: '',
  featuredNote: '',
  updatedAt: null,
};

const getPublicSiteConfig = async (req, res) => {
  try {
    const cached = publicDataCache.get(SITE_CONFIG_CACHE_KEY);
    if (cached) {
      res.set('Cache-Control', PUBLIC_CACHE_CONTROL);
      return res.json(cached);
    }

    const db = getDb();
    const doc = await db.collection('site_configs').findOne({ _id: 'default' });
    const payload = !doc
      ? DEFAULT_CONFIG
      : {
          heroBackgroundUrl: doc.heroBackgroundUrl || '',
          announcementBanner: doc.announcementBanner || '',
          featuredNote: doc.featuredNote || '',
          updatedAt: doc.updatedAt || null,
        };

    publicDataCache.set(SITE_CONFIG_CACHE_KEY, payload);
    res.set('Cache-Control', PUBLIC_CACHE_CONTROL);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateSiteConfig = async (req, res) => {
  try {
    const db = getDb();
    const { heroBackgroundUrl = '', announcementBanner = '', featuredNote = '' } = req.body;
    const updateDoc = {
      heroBackgroundUrl: String(heroBackgroundUrl).trim(),
      announcementBanner: String(announcementBanner).trim(),
      featuredNote: String(featuredNote).trim(),
      updatedAt: new Date(),
      updatedBy: req.admin ? req.admin.username : 'admin',
    };

    await db.collection('site_configs').updateOne(
      { _id: 'default' },
      { $set: updateDoc },
      { upsert: true }
    );

    publicDataCache.del(SITE_CONFIG_CACHE_KEY);

    res.json({
      heroBackgroundUrl: updateDoc.heroBackgroundUrl,
      announcementBanner: updateDoc.announcementBanner,
      featuredNote: updateDoc.featuredNote,
      updatedAt: updateDoc.updatedAt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getPublicSiteConfig, updateSiteConfig };
