import { Router } from 'express';
import { upload, validateData } from '../controllers/data.controller';
import { validate } from '../middlewares/validate.middleware';
import { authMiddleware } from '../middlewares/auth.middleware';
import { uploadDataFile } from '../utils/upload';
import { ValidateDataSchema } from '../schemas/data.schema';

const router = Router();

router.use(authMiddleware);

router.post('/upload', uploadDataFile.single('file'), upload);
router.post('/validate', validate(ValidateDataSchema), validateData);

export default router;
