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
      // filters: dangling=false removes all unused images, not just dangling ones
      const res = await this.docker.pruneImages({ filters: { dangling: ['false'] } });
      return res;
    } catch (error) {
      throw new Error(`Failed to prune unused images: ${error.message}`);
    }
  }
}

export default new DockerService();
