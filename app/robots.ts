import type { MetadataRoute } from 'next';

const { getPublicRobots } = require('@/lib/seo/public-routes.js');

export default function robots(): MetadataRoute.Robots {
  return getPublicRobots();
}