import Docker from 'dockerode';

class DockerService {
  constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  async getInfo() {
    try {
      return await this.docker.info();
    } catch (error) {
      throw new Error('Docker daemon is not reachable. Is Docker installed and running?');
    }
  }

  async getDashboardSummary() {
    try {
      const info = await this.docker.info();
      return {
        containers: info.Containers,
        containersRunning: info.ContainersRunning,
        containersStopped: info.ContainersStopped,
        images: info.Images,
        operatingSystem: info.OperatingSystem,
      };
    } catch (error) {
      return null;
    }
  }

  async listContainers(all = true) {
    try {
      const containers = await this.docker.listContainers({ all });
      return containers.map(c => ({
        id: c.Id.substring(0, 12),
        names: c.Names.map(n => n.replace('/', '')),
        image: c.Image,
        state: c.State,
        status: c.Status,
        ports: c.Ports,
        created: c.Created
      }));
    } catch (error) {
      throw new Error(`Failed to list containers: ${error.message}`);
    }
  }

  async getContainerInfo(id) {
    try {
      const container = this.docker.getContainer(id);
      return await container.inspect();
    } catch (error) {
      throw new Error(`Failed to inspect container: ${error.message}`);
    }
  }

  async startContainer(id) {
    try {
      const container = this.docker.getContainer(id);
      await container.start();
      return true;
    } catch (error) {
      throw new Error(`Failed to start container: ${error.message}`);
    }
  }

  async stopContainer(id) {
    try {
      const container = this.docker.getContainer(id);
      await container.stop();
      return true;
    } catch (error) {
      throw new Error(`Failed to stop container: ${error.message}`);
    }
  }

  async restartContainer(id) {
    try {
      const container = this.docker.getContainer(id);
      await container.restart();
      return true;
    } catch (error) {
      throw new Error(`Failed to restart container: ${error.message}`);
    }
  }

  async killContainer(id) {
    try {
      const container = this.docker.getContainer(id);
      await container.kill();
      return true;
    } catch (error) {
      throw new Error(`Failed to kill container: ${error.message}`);
    }
  }

  async removeContainer(id, force = false) {
    try {
      const container = this.docker.getContainer(id);
      await container.remove({ force });
      return true;
    } catch (error) {
      throw new Error(`Failed to remove container: ${error.message}`);
    }
  }

  async listImages() {
    try {
      const images = await this.docker.listImages();
      const containers = await this.docker.listContainers({ all: true });
      return images.map(img => {
        const usingContainers = containers.filter(c => c.ImageID === img.Id).map(c => ({
          id: c.Id.substring(0, 12),
          names: c.Names.map(n => n.replace('/', '')),
          state: c.State
        }));
        return {
          id: img.Id.split(':')[1].substring(0, 12),
          rawId: img.Id,
          tags: img.RepoTags || [],
          size: img.Size,
          created: img.Created,
          containers: usingContainers
        };
      });
    } catch (error) {
      throw new Error(`Failed to list images: ${error.message}`);
    }
  }

  async removeImage(id, force = false) {
    try {
      const image = this.docker.getImage(id);
      await image.remove({ force });
      return true;
    } catch (error) {
      throw new Error(`Failed to remove image: ${error.message}`);
    }
  }

  async pruneImages() {
    try {
      const res = await this.docker.pruneImages({ filters: { dangling: ['false'] } });
      return res;
    } catch (error) {
      throw new Error(`Failed to prune unused images: ${error.message}`);
    }
  }

  async searchImages(term) {
    try {
      return await this.docker.searchImages({ term });
    } catch (error) {
      throw new Error(`Failed to search images: ${error.message}`);
    }
  }

  async createContainer(data) {
    try {
      // Map ports
      const PortBindings = {};
      const ExposedPorts = {};
      if (data.ports && Array.isArray(data.ports)) {
        data.ports.forEach(p => {
          if (p.containerPort && p.hostPort) {
            const containerPortProto = `${p.containerPort}/tcp`;
            ExposedPorts[containerPortProto] = {};
            PortBindings[containerPortProto] = [{ HostPort: String(p.hostPort) }];
          }
        });
      }

      // Map volumes
      const Binds = [];
      if (data.volumes && Array.isArray(data.volumes)) {
        data.volumes.forEach(v => {
          if (v.hostPath && v.containerPath) {
            Binds.push(`${v.hostPath}:${v.containerPath}`);
          }
        });
      }

      // Map envs
      const Env = [];
      if (data.env && Array.isArray(data.env)) {
        data.env.forEach(e => {
          if (e.key && e.value) {
            Env.push(`${e.key}=${e.value}`);
          }
        });
      }

      const optsf = {
        Image: data.image,
        name: data.name,
        ExposedPorts,
        HostConfig: {
          PortBindings,
          Binds,
          RestartPolicy: { Name: data.restart || 'unless-stopped' }
        },
        Env
      };

      const container = await this.docker.createContainer(optsf);
      if (data.startAfterCreate) {
        await container.start();
      }
      return { id: container.id.substring(0, 12) };
    } catch (error) {
      throw new Error(`Failed to create container: ${error.message}`);
    }
  }

  async deployCompose(projectName, composeYaml) {
    try {
      const fs = (await import('fs/promises')).default;
      const path = (await import('path')).default;
      const { exec } = await import('child_process');
      const util = (await import('util')).default;
      const execAsync = util.promisify(exec);

      const composeDir = path.resolve('storage', 'docker-compose', projectName);
      await fs.mkdir(composeDir, { recursive: true });

      const composePath = path.join(composeDir, 'docker-compose.yml');
      await fs.writeFile(composePath, composeYaml, 'utf-8');

      // Run docker-compose up
      const { stdout, stderr } = await execAsync(`docker compose -p ${projectName} -f "${composePath}" up -d`);
      return { success: true, log: stdout || stderr };
    } catch (error) {
      throw new Error(`Failed to deploy Docker Compose: ${error.message}`);
    }
  }
}

export default new DockerService();
