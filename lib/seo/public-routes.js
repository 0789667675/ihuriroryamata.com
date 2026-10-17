const SITE_URL = 'https://www.ihuriroryamata.com';

const getPublicRobots = () => ({
  rules: [{
    userAgent: '*',
    allow: '/',
    disallow: ['/api/', '/dashboard'],
  }],
  sitemap: `${SITE_URL}/sitemap.xml`,
});

const getPublicSitemap = () => [{ url: SITE_URL }];

module.exports = { SITE_URL, getPublicRobots, getPublicSitemap };