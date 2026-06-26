import { Router } from 'express';
import { getDocument, saveDocument, previewDocument, getVersions, restoreVersion, validateDocument } from '../controllers/designer.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { checkOwnership } from '../middlewares/ownership.middleware';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.get('/', checkOwnership('template'), getDocument);
router.put('/', checkOwnership('template'), saveDocument);
router.post('/preview', checkOwnership('template'), previewDocument);
router.get('/versions', checkOwnership('template'), getVersions);
router.post('/restore/:version', checkOwnership('template'), restoreVersion);
router.post('/validate', checkOwnership('template'), validateDocument);

export default router;
