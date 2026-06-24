import { Router } from 'express';
import { create, list, getOne, retry, remove, downloadZip, listDocuments, downloadDocument } from '../controllers/job.controller';
import { validate } from '../middlewares/validate.middleware';
import { authMiddleware } from '../middlewares/auth.middleware';
import { checkOwnership } from '../middlewares/ownership.middleware';
import { CreateJobSchema } from '../schemas/job.schema';

const router = Router();

router.use(authMiddleware);

router.post('/', validate(CreateJobSchema), create);
router.get('/', list);
router.get('/:id', checkOwnership('generationJob'), getOne);
router.post('/:id/retry', checkOwnership('generationJob'), retry);
router.delete('/:id', checkOwnership('generationJob'), remove);

// Download Endpoints
router.get('/:id/download/zip', checkOwnership('generationJob'), downloadZip);
router.get('/:id/documents', checkOwnership('generationJob'), listDocuments);
router.get('/:id/documents/:docId/download', checkOwnership('generationJob'), downloadDocument);

export default router;
