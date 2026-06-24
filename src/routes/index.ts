import { Router } from 'express';
import authRoutes from './auth.routes';
import templateRoutes from './template.routes';
import dataRoutes from './data.routes';
import jobRoutes from './job.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/templates', templateRoutes);
router.use('/data', dataRoutes);
router.use('/jobs', jobRoutes);

export default router;
