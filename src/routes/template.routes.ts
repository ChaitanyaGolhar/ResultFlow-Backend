import { Router } from 'express';
import { upload, list, getOne, update, remove, saveFields } from '../controllers/template.controller';
import { validate } from '../middlewares/validate.middleware';
import { authMiddleware } from '../middlewares/auth.middleware';
import { checkOwnership } from '../middlewares/ownership.middleware';
import { uploadTemplate } from '../utils/upload';
import { UpdateTemplateSchema, UpdateTemplateFieldsSchema } from '../schemas/template.schema';

const router = Router();

router.use(authMiddleware);

router.post('/', uploadTemplate.single('file'), upload);
router.get('/', list);
router.get('/:id', checkOwnership('template'), getOne);
router.put('/:id', checkOwnership('template'), validate(UpdateTemplateSchema), update);
router.delete('/:id', checkOwnership('template'), remove);

router.put('/:id/fields', checkOwnership('template'), validate(UpdateTemplateFieldsSchema), saveFields);

export default router;
