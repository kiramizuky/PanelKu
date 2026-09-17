/**
 * Lightweight Kubernetes (K3s / MicroK8s) Cluster Service (Fase 5)
 */
import logger from '../../config/logger.js';
import { execCmd } from '../../helpers/exec.js';

class K8sService {
  constructor() {
    this._cli = null;
  }

  /**
   * Detect available kubectl CLI binary (k3s kubectl, microk8s kubectl, or kubectl)
   */
  async detectCli() {
    if (this._cli) return this._cli;

    // [SAFE] Each candidate is a hardcoded string — split into bin + args for execFile
    const candidates = [
      { bin: 'k3s', args: ['kubectl'] },
      { bin: 'microk8s', args: ['kubectl'] },
      { bin: 'kubectl', args: [] },
    ];

    for (const { bin, args } of candidates) {
      try {
        // [SAFE] execFile: kubectl version --client -o json
        const stdout = await execCmd(bin, [...args, 'version', '--client', '-o', 'json'], { timeout: 5000 });
        if (stdout && stdout.includes('gitVersion')) {
          this._cli = [bin, ...args].join(' ');
          return this._cli;
        }
      } catch {
        // Not found
      }
    }

    return null;
  }

  /**
   * Get K8s Cluster Status & Resources Summary
   */
  async getClusterSummary() {
    const cli = await this.detectCli();
    if (!cli) {
      return {
        installed: false,
        engine: 'none',
        message: 'No active Kubernetes engine (K3s / MicroK8s / standard K8s) detected on host.',
        nodes: [],
        pods: [],
        services: [],
      };
    }

    try {
      // [SAFE] cli is from detectCli() — hardcoded candidates, no user input
      const cliParts = cli.split(' ');
      const [nodesOut, podsOut, svcOut] = await Promise.all([
        execCmd(cliParts[0], [...cliParts.slice(1), 'get', 'nodes', '-o', 'json'], { timeout: 10000 }).catch(() => '{"items":[]}'),
        execCmd(cliParts[0], [...cliParts.slice(1), 'get', 'pods', '-A', '-o', 'json'], { timeout: 10000 }).catch(() => '{"items":[]}'),
        execCmd(cliParts[0], [...cliParts.slice(1), 'get', 'svc', '-A', '-o', 'json'], { timeout: 10000 }).catch(() => '{"items":[]}'),
      ]);

      const nodes = JSON.parse(nodesOut || '{"items":[]}').items || [];
      const pods = JSON.parse(podsOut || '{"items":[]}').items || [];
      const services = JSON.parse(svcOut || '{"items":[]}').items || [];

      return {
        installed: true,
        engine: cli.split(' ')[0],
        nodeCount: nodes.length,
        podCount: pods.length,
        serviceCount: services.length,
        nodes: nodes.map(n => ({
          name: n.metadata?.name,
          status: n.status?.conditions?.slice(-1)[0]?.type || 'Unknown',
          roles: Object.keys(n.metadata?.labels || {}).filter(l => l.includes('node-role')).join(', ') || 'worker',
          kubeletVersion: n.status?.nodeInfo?.kubeletVersion,
          osImage: n.status?.nodeInfo?.osImage,
        })),
        pods: pods.slice(0, 30).map(p => ({
          namespace: p.metadata?.namespace,
          name: p.metadata?.name,
          phase: p.status?.phase,
          podIP: p.status?.podIP,
          startTime: p.status?.startTime,
        })),
        services: services.map(s => ({
          namespace: s.metadata?.namespace,
          name: s.metadata?.name,
          type: s.spec?.type,
          clusterIP: s.spec?.clusterIP,
          ports: s.spec?.ports?.map(pt => `${pt.port}/${pt.protocol}`).join(', '),
        })),
      };
    } catch (error) {
      logger.error(`[K8sService] Error querying cluster: ${error.message}`);
      return {
        installed: true,
        engine: cli.split(' ')[0],
        error: error.message,
        nodes: [],
        pods: [],
        services: [],
      };
    }
  }
}

export default new K8sService();
