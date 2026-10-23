import { defineModule } from '../module-descriptor';
import { SearchController } from './search.controller';

/** SEARCH, the global search of IAM-07 (ST-IAM-008): one read over the tenant projection, filtered by tenant and access scope. */
export const searchModule = defineModule({
  code: 'SEARCH',
  controllers: [SearchController],
});
