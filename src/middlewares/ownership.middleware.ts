import { Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from './auth.middleware';

export const checkOwnership = (modelName: 'template' | 'generationJob') => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const resourceId = req.params.id;
      const userId = req.user!.id;

      let resource: any = null;

      if (modelName === 'template') {
        resource = await prisma.template.findUnique({
          where: { id: resourceId }
        });
      } else if (modelName === 'generationJob') {
        resource = await prisma.generationJob.findUnique({
          where: { id: resourceId }
        });
      }

      if (!resource) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Resource not found', details: [] }
        });
      }

      if (resource.userId !== userId) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not have permission to access this resource', details: [] }
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
