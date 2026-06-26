import { Router } from 'express';
import { upload, list, getOne, update, remove } from '../controllers/template.controller';
import { validate } from '../middlewares/validate.middleware';
import { authMiddleware } from '../middlewares/auth.middleware';
import { checkOwnership } from '../middlewares/ownership.middleware';
import { uploadTemplate } from '../utils/upload';
import { UpdateTemplateSchema } from '../schemas/template.schema';

const router = Router();

router.use(authMiddleware);

router.post('/', uploadTemplate.single('file'), upload);
router.get('/', list);
router.get('/:id', checkOwnership('template'), getOne);
router.put('/:id', checkOwnership('template'), validate(UpdateTemplateSchema), update);
router.delete('/:id', checkOwnership('template'), remove);



export default router;
