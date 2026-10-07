import * as authService from '@/lib/services/auth-service.js';

export const registerUser = authService.registerUser;
export const loginUser = authService.loginUser;
export const getCurrentUser = authService.getCurrentUser;
export const logoutUser = authService.logoutUser;
export const sanitizeUser = authService.sanitizeUser;
export const normalizeAccountType = authService.normalizeAccountType;
export const validatePassword = authService.validatePassword;
export const assertUserCanAccessOwnerScopedResource = authService.assertUserCanAccessOwnerScopedResource;

export default authService;
