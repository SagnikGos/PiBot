import fs from 'fs';
import path from 'path';

export interface ProjectContext {
  isGitRepo: boolean;
  hasPackageJson: boolean;
  hasTsConfig: boolean;
  projectName?: string;
  projectVersion?: string;
}

export function scanProjectContext(projectRoot: string): ProjectContext {
  const isGitRepo = fs.existsSync(path.join(projectRoot, '.git'));
  const hasTsConfig = fs.existsSync(path.join(projectRoot, 'tsconfig.json'));
  let hasPackageJson = false;
  let projectName: string | undefined;
  let projectVersion: string | undefined;

  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    hasPackageJson = true;
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      projectName = pkg.name;
      projectVersion = pkg.version;
    } catch (e) {
      // Ignore parse errors
    }
  }

  return {
    isGitRepo,
    hasPackageJson,
    hasTsConfig,
    projectName,
    projectVersion
  };
}
