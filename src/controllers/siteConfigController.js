const { getDb } = require('../config/db');

const DEFAULT_CONFIG = {
  heroBackgroundUrl: '',
  announcementBanner: '',
  featuredNote: '',
  updatedAt: null,
};

const getPublicSiteConfig = async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('site_configs').findOne({ _id: 'default' });
    if (!doc) {
      return res.json(DEFAULT_CONFIG);
    }
    res.json({
      heroBackgroundUrl: doc.heroBackgroundUrl || '',
      announcementBanner: doc.announcementBanner || '',
      featuredNote: doc.featuredNote || '',
      updatedAt: doc.updatedAt || null,
    });
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
