export {
  repository,
  normalizeEmail,
  sanitizeUser,
  createUserWithConnection,
  resetInMemoryUsers,
} from '@/lib/repositories/userRepository.js';

import { repository } from '@/lib/repositories/userRepository.js';

export const userRepository = repository;
export default userRepository;
