import type { MetadataRoute } from 'next';

const { getPublicSitemap } = require('@/lib/seo/public-routes.js');

export default function sitemap(): MetadataRoute.Sitemap {
  return getPublicSitemap();
}