const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();

const CONFIG_FILE = 'homelab_services.json';
const TABS_CONFIG_FILE = 'homelab_tabs.json';
const IP_WHITELIST_FILE = 'ip_whitelist.json';
const DEFAULT_SERVICES = [];
const DEFAULT_TABS = [{ id: 'default', name: 'Default' }];
const DEFAULT_IP_WHITELIST = ['127.0.0.1', '::1'];

// Load IP whitelist
function loadIPWhitelist() {
    try {
        if (fsSync.existsSync(IP_WHITELIST_FILE)) {
            const data = JSON.parse(fsSync.readFileSync(IP_WHITELIST_FILE, 'utf8'));
            return data.allowed_ips || DEFAULT_IP_WHITELIST;
        } else {
            return DEFAULT_IP_WHITELIST;
        }
    } catch (e) {
        console.error(`Error loading IP whitelist: ${e}`);
        return DEFAULT_IP_WHITELIST;
    }
}

// IP Whitelist middleware
const ipWhitelist = loadIPWhitelist();
app.use((req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    const normalizedIP = clientIP.replace(/^::ffff:/, ''); // Remove IPv6 prefix for IPv4
    
    if (ipWhitelist.includes(normalizedIP) || ipWhitelist.includes(clientIP)) {
        next();
    } else {
        console.warn(`Access denied from IP: ${clientIP}`);
        res.status(403).json({
            success: false,
            error: 'Access denied: IP not whitelisted',
            ip: clientIP
        });
    }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:80', 'http://127.0.0.1:80', 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true
}));
app.use('/static', express.static('static'));
app.use(express.static('static'));

app.set('view engine', 'html');
app.engine('html', (filePath, options, callback) => {
    fs.readFile(filePath, (err, content) => {
        if (err) return callback(err);
        return callback(null, content.toString());
    });
});

async function loadServices(tabId = 'default') {
    try {
        const configFile = tabId === 'default' ? CONFIG_FILE : `homelab_services_${tabId}.json`;
        if (fsSync.existsSync(configFile)) {
            const data = JSON.parse(await fs.readFile(configFile, 'utf8'));
            const services = [];
            for (const service of data.services || []) {
                if (!service.column) {
                    service.column = 0;
                }
                services.push(service);
            }
            return services;
        } else {
            return DEFAULT_SERVICES;
        }
    } catch (e) {
        console.error(`Error loading services for tab ${tabId}: ${e}`);
        return DEFAULT_SERVICES;
    }
}

async function loadTabs() {
    try {
        if (fsSync.existsSync(TABS_CONFIG_FILE)) {
            const data = JSON.parse(await fs.readFile(TABS_CONFIG_FILE, 'utf8'));
            return data.tabs || DEFAULT_TABS;
        } else {
            return DEFAULT_TABS;
        }
    } catch (e) {
        console.error(`Error loading tabs: ${e}`);
        return DEFAULT_TABS;
    }
}

async function saveServices(services, tabId = 'default') {
    try {
        const configFile = tabId === 'default' ? CONFIG_FILE : `homelab_services_${tabId}.json`;
        
        const data = {
            services: services,
            last_updated: new Date().toISOString()
        };
        
        await fs.writeFile(configFile, JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        console.error(`Error saving services for tab ${tabId}: ${e}`);
        return false;
    }
}

async function saveTabs(tabs) {
    try {
        const data = {
            tabs: tabs,
            last_updated: new Date().toISOString()
        };
        
        await fs.writeFile(TABS_CONFIG_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        console.error(`Error saving tabs: ${e}`);
        return false;
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/api/tabs', async (req, res) => {
    try {
        const tabs = await loadTabs();
        res.json({
            success: true,
            tabs: tabs,
            count: tabs.length
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.get('/api/services', async (req, res) => {
    try {
        const tabId = req.query.tab || 'default';
        const services = await loadServices(tabId);
        res.json({
            success: true,
            services: services,
            count: services.length,
            tab: tabId
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.post('/api/tabs', async (req, res) => {
    try {
        const data = req.body;
        
        if (!data || !data.tab) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request data: tab information is required'
            });
        }
        
        const tab = data.tab;
        const requiredFields = ['id', 'name'];
        
        for (const field of requiredFields) {
            if (!tab[field] || !tab[field].trim()) {
                return res.status(400).json({
                    success: false,
                    error: `Tab ${field} is required and cannot be empty`
                });
            }
        }
        
        const tabs = await loadTabs();
        
        if (tabs.find(t => t.id === tab.id)) {
            return res.status(400).json({
                success: false,
                error: 'Tab with this ID already exists. Please choose a different name.'
            });
        }
        
        tabs.push(tab);
        const success = await saveTabs(tabs);
        
        if (success) {
            res.json({
                success: true,
                message: 'Tab created successfully',
                tab: tab
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to create tab due to a server error. Please try again.'
            });
        }
    } catch (e) {
        res.status(500).json({
            success: false,
            error: `Server error while creating tab: ${e.message}`
        });
    }
});

app.post('/api/services', async (req, res) => {
    try {
        const tabId = req.query.tab || 'default';
        const data = req.body;
        
        if (!data || !data.services) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request data: services array is required'
            });
        }
        
        const services = data.services;
        
        for (let i = 0; i < services.length; i++) {
            const service = services[i];
            const requiredFields = ['name', 'url'];
            
            for (const field of requiredFields) {
                if (!service[field] || !service[field].trim()) {
                    return res.status(400).json({
                        success: false,
                        error: `Service "${service.name || 'Unknown'}": ${field} is required and cannot be empty`
                    });
                }
            }
            
            // Validate URL format
            try {
                new URL(service.url.startsWith('http') ? service.url : `http://${service.url}`);
            } catch {
                return res.status(400).json({
                    success: false,
                    error: `Service "${service.name}": Invalid URL format. Please include http:// or https://`
                });
            }
            
            if (!service.column) {
                service.column = 0;
            } else {
                service.column = Math.max(0, Math.min(2, parseInt(service.column)));
            }
            
            if (!service.description) {
                service.description = '';
            }
        }
        
        const success = await saveServices(services, tabId);
        
        if (success) {
            res.json({
                success: true,
                message: `${services.length} service(s) saved successfully to tab "${tabId}"`,
                count: services.length,
                tab: tabId
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to save services due to a server error. Please try again.'
            });
        }
    } catch (e) {
        res.status(500).json({
            success: false,
            error: `Server error while saving services: ${e.message}`
        });
    }
});

app.put('/api/tabs/:tabId', async (req, res) => {
    try {
        const tabId = req.params.tabId;
        const data = req.body;
        
        if (!data || !data.name) {
            return res.status(400).json({
                success: false,
                error: 'Name is required'
            });
        }
        
        const tabs = await loadTabs();
        const tab = tabs.find(t => t.id === tabId);
        
        if (!tab) {
            return res.status(404).json({
                success: false,
                error: 'Tab not found'
            });
        }
        
        tab.name = data.name.trim();
        const success = await saveTabs(tabs);
        
        if (success) {
            res.json({
                success: true,
                message: 'Tab renamed successfully',
                tab: tab
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to rename tab'
            });
        }
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.delete('/api/tabs/:tabId', async (req, res) => {
    try {
        const tabId = req.params.tabId;
        
        if (tabId === 'default') {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete default tab'
            });
        }
        
        const tabs = await loadTabs();
        const tabIndex = tabs.findIndex(t => t.id === tabId);
        
        if (tabIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Tab not found'
            });
        }
        
        const deletedTab = tabs.splice(tabIndex, 1)[0];
        
        // Delete the services file for this tab
        const configFile = `homelab_services_${tabId}.json`;
        if (fsSync.existsSync(configFile)) {
            await fs.unlink(configFile);
        }
        
        const success = await saveTabs(tabs);
        
        if (success) {
            res.json({
                success: true,
                message: `Tab "${deletedTab.name}" deleted successfully`
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to delete tab'
            });
        }
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.delete('/api/services/:serviceId', async (req, res) => {
    try {
        const serviceId = parseInt(req.params.serviceId);
        const tabId = req.query.tab || 'default';
        const services = await loadServices(tabId);
        
        if (serviceId < 0 || serviceId >= services.length) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }
        
        const deletedService = services.splice(serviceId, 1)[0];
        const success = await saveServices(services, tabId);
        
        if (success) {
            res.json({
                success: true,
                message: `Service "${deletedService.name}" deleted successfully`
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to delete service'
            });
        }
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.post('/api/services/reorder', async (req, res) => {
    try {
        const tabId = req.query.tab || 'default';
        const data = req.body;
        
        if (!data || !data.services) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request data'
            });
        }
        
        const services = data.services;
        const success = await saveServices(services, tabId);
        
        if (success) {
            res.json({
                success: true,
                message: 'Services reordered successfully'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to reorder services'
            });
        }
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.post('/api/services/:serviceId/move', async (req, res) => {
    try {
        const serviceId = parseInt(req.params.serviceId);
        const { fromTab, toTab } = req.body;
        
        if (!fromTab || !toTab) {
            return res.status(400).json({
                success: false,
                error: 'Source tab and destination tab are required'
            });
        }
        
        if (fromTab === toTab) {
            return res.status(400).json({
                success: false,
                error: 'Source and destination tabs cannot be the same'
            });
        }
        
        // Load services from source tab
        const sourceServices = await loadServices(fromTab);
        
        if (serviceId < 0 || serviceId >= sourceServices.length) {
            return res.status(404).json({
                success: false,
                error: 'Service not found in source tab'
            });
        }
        
        // Remove service from source tab
        const [movedService] = sourceServices.splice(serviceId, 1);
        
        // Load services from destination tab
        const destServices = await loadServices(toTab);
        
        // Add service to destination tab
        destServices.push(movedService);
        
        // Save both tabs
        const sourceSuccess = await saveServices(sourceServices, fromTab);
        const destSuccess = await saveServices(destServices, toTab);
        
        if (sourceSuccess && destSuccess) {
            res.json({
                success: true,
                message: `Service "${movedService.name}" moved from "${fromTab}" to "${toTab}" successfully`,
                service: movedService,
                fromTab: fromTab,
                toTab: toTab
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to move service due to a server error'
            });
        }
    } catch (e) {
        res.status(500).json({
            success: false,
            error: `Server error while moving service: ${e.message}`
        });
    }
});

app.get('/api/export/all', async (req, res) => {
    try {
        const tabs = await loadTabs();
        const allServices = {};
        
        // Load services for each tab
        for (const tab of tabs) {
            allServices[tab.id] = await loadServices(tab.id);
        }
        
        res.json({
            success: true,
            tabs: tabs,
            services: allServices,
            exported_at: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.post('/api/import/all', async (req, res) => {
    try {
        const data = req.body;
        
        if (!data || !data.tabs || !data.services) {
            return res.status(400).json({
                success: false,
                error: 'Invalid import data format'
            });
        }
        
        // Validate tabs
        const tabs = data.tabs;
        for (let i = 0; i < tabs.length; i++) {
            const tab = tabs[i];
            const requiredFields = ['id', 'name'];
            
            for (const field of requiredFields) {
                if (!tab[field] || !tab[field].trim()) {
                    return res.status(400).json({
                        success: false,
                        error: `Tab ${i+1}: ${field} is required`
                    });
                }
            }
        }
        
        // Save tabs
        const tabsSuccess = await saveTabs(tabs);
        if (!tabsSuccess) {
            return res.status(500).json({
                success: false,
                error: 'Failed to save tabs'
            });
        }
        
        // Save services for each tab
        const services = data.services;
        for (const [tabId, tabServices] of Object.entries(services)) {
            if (Array.isArray(tabServices)) {
                // Validate services
                for (let i = 0; i < tabServices.length; i++) {
                    const service = tabServices[i];
                    const requiredFields = ['name', 'url'];
                    
                    for (const field of requiredFields) {
                        if (!service[field] || !service[field].trim()) {
                            return res.status(400).json({
                                success: false,
                                error: `Service ${i+1} in tab ${tabId}: ${field} is required`
                            });
                        }
                    }
                    
                    if (!service.column) {
                        service.column = 0;
                    } else {
                        service.column = Math.max(0, Math.min(2, parseInt(service.column)));
                    }
                    
                    if (!service.description) {
                        service.description = '';
                    }
                }
                
                const servicesSuccess = await saveServices(tabServices, tabId);
                if (!servicesSuccess) {
                    return res.status(500).json({
                        success: false,
                        error: `Failed to save services for tab ${tabId}`
                    });
                }
            }
        }
        
        res.json({
            success: true,
            message: 'Dashboard imported successfully',
            tabs_count: tabs.length,
            services_count: Object.values(services).reduce((sum, s) => sum + s.length, 0)
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.get('/api/health', async (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        config_file: CONFIG_FILE,
        config_exists: fsSync.existsSync(CONFIG_FILE)
    });
});

app.post('/api/backup', async (req, res) => {
    try {
        // Create full backup including all tabs and services
        const tabs = await loadTabs();
        const allServices = {};
        
        // Load services for each tab
        for (const tab of tabs) {
            allServices[tab.id] = await loadServices(tab.id);
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `homelab_backup_${timestamp}.json`;
        
        // Extract service URLs for backup metadata
        const serviceUrls = [];
        for (const [tabId, services] of Object.entries(allServices)) {
            const tab = tabs.find(t => t.id === tabId);
            for (const service of services) {
                serviceUrls.push({
                    name: service.name,
                    url: service.url,
                    tab: tab?.name || tabId
                });
            }
        }

        const backupData = {
            tabs: tabs,
            services: allServices,
            service_urls: serviceUrls,
            backup_type: 'manual',
            created_at: new Date().toISOString(),
            version: '1.0'
        };
        
        await fs.writeFile(backupName, JSON.stringify(backupData, null, 2));
        
        res.json({
            success: true,
            message: 'Full backup created successfully',
            backup_file: backupName,
            includes_tabs: tabs.length,
            includes_services: Object.values(allServices).reduce((sum, services) => sum + services.length, 0)
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.get('/api/backups', async (req, res) => {
    try {
        const allFiles = await fs.readdir('.');
        console.log('All files in directory:', allFiles.filter(f => f.includes('backup')));
        
        const backupFiles = allFiles
            .filter(f => f.startsWith('homelab_backup_') && f.endsWith('.json'))
            .sort()
            .reverse();
        
        console.log('Found backup files:', backupFiles);
        
        const backups = [];
        for (const backupFile of backupFiles) {
            const stats = await fs.stat(backupFile);
            const backupData = JSON.parse(await fs.readFile(backupFile, 'utf8'));
            
            backups.push({
                filename: backupFile,
                created: new Date(stats.mtime).toISOString(),
                size: stats.size,
                backup_type: backupData.backup_type || 'manual',
                includes_tabs: backupData.tabs?.length || 0,
                includes_services: backupData.services ? Object.values(backupData.services).reduce((sum, services) => sum + services.length, 0) : 0,
                service_urls: backupData.service_urls || [],
                comment: backupData.comment || ''
            });
        }
        
        console.log('Processed backups:', backups);
        
        res.json({
            success: true,
            backups: backups
        });
    } catch (e) {
        console.error('Error in /api/backups:', e);
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.post('/api/restore/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        
        // Validate filename to prevent directory traversal
        if (!filename.startsWith('homelab_backup_') || !filename.endsWith('.json')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid backup filename'
            });
        }
        
        if (!fsSync.existsSync(filename)) {
            return res.status(404).json({
                success: false,
                error: 'Backup file not found'
            });
        }
        
        const backupData = JSON.parse(await fs.readFile(filename, 'utf8'));
        
        if (!backupData.tabs || !backupData.services) {
            return res.status(400).json({
                success: false,
                error: 'Invalid backup format'
            });
        }
        
        // Restore tabs
        const tabsSuccess = await saveTabs(backupData.tabs);
        if (!tabsSuccess) {
            return res.status(500).json({
                success: false,
                error: 'Failed to restore tabs'
            });
        }
        
        // Restore services for each tab
        let restoredServices = 0;
        for (const [tabId, services] of Object.entries(backupData.services)) {
            if (Array.isArray(services)) {
                const servicesSuccess = await saveServices(services, tabId);
                if (servicesSuccess) {
                    restoredServices += services.length;
                }
            }
        }
        
        res.json({
            success: true,
            message: 'Backup restored successfully',
            restored_tabs: backupData.tabs.length,
            restored_services: restoredServices
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.get('/api/download/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        
        // Validate filename to prevent directory traversal
        if (!filename.startsWith('homelab_backup_') || !filename.endsWith('.json')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid backup filename'
            });
        }
        
        if (!fsSync.existsSync(filename)) {
            return res.status(404).json({
                success: false,
                error: 'Backup file not found'
            });
        }
        
        res.download(filename, filename);
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.post('/api/export/download', async (req, res) => {
    try {
        console.log('Request body:', req.body);
        console.log('Content-Type:', req.get('Content-Type'));
        
        let data, filename;
        
        // Handle both JSON and form data
        if (req.is('application/json')) {
            ({ data, filename } = req.body);
        } else {
            // Form data submission
            data = req.body.data;
            filename = req.body.filename;
            
            // Parse JSON string from form data
            if (typeof data === 'string') {
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid JSON data'
                    });
                }
            }
        }
        
        console.log('Parsed data:', data);
        console.log('Parsed filename:', filename);
        
        if (!data || !filename) {
            return res.status(400).json({
                success: false,
                error: 'Data and filename are required'
            });
        }
        
        // Validate filename
        if (!filename.endsWith('.json')) {
            return res.status(400).json({
                success: false,
                error: 'Filename must end with .json'
            });
        }
        
        // Set headers for download
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify(data, null, 2));
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

// Update backup comment
app.post('/api/backup/:filename/comment', async (req, res) => {
    try {
        const filename = req.params.filename;
        const { comment } = req.body;
        
        if (!filename.startsWith('homelab_backup_') || !filename.endsWith('.json')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid backup filename'
            });
        }
        
        if (!fsSync.existsSync(filename)) {
            return res.status(404).json({
                success: false,
                error: 'Backup file not found'
            });
        }
        
        const backupData = JSON.parse(await fs.readFile(filename, 'utf8'));
        backupData.comment = comment;
        backupData.last_modified = new Date().toISOString();
        
        await fs.writeFile(filename, JSON.stringify(backupData, null, 2));
        
        res.json({
            success: true,
            message: 'Backup comment updated successfully'
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

// Rename backup
app.put('/api/backup/:filename', async (req, res) => {
    try {
        const oldFilename = req.params.filename;
        const { newFilename } = req.body;
        
        if (!oldFilename.startsWith('homelab_backup_') || !oldFilename.endsWith('.json')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid backup filename'
            });
        }
        
        if (!newFilename || typeof newFilename !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'New filename is required'
            });
        }
        
        // Ensure new filename has proper format
        const finalNewFilename = newFilename.endsWith('.json') ? newFilename : `${newFilename}.json`;
        if (!finalNewFilename.startsWith('homelab_backup_') || !finalNewFilename.endsWith('.json')) {
            return res.status(400).json({
                success: false,
                error: 'New filename must start with "homelab_backup_" and end with ".json"'
            });
        }
        
        if (!fsSync.existsSync(oldFilename)) {
            return res.status(404).json({
                success: false,
                error: 'Backup file not found'
            });
        }
        
        if (fsSync.existsSync(finalNewFilename)) {
            return res.status(400).json({
                success: false,
                error: 'A backup with this name already exists'
            });
        }
        
        await fs.rename(oldFilename, finalNewFilename);
        
        res.json({
            success: true,
            message: 'Backup renamed successfully',
            old_filename: oldFilename,
            new_filename: finalNewFilename
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

// Delete backup
app.delete('/api/backup/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        
        if (!filename.startsWith('homelab_backup_') || !filename.endsWith('.json')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid backup filename'
            });
        }
        
        if (!fsSync.existsSync(filename)) {
            return res.status(404).json({
                success: false,
                error: 'Backup file not found'
            });
        }
        
        await fs.unlink(filename);
        
        res.json({
            success: true,
            message: 'Backup deleted successfully'
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

// Debug endpoint to list all files
app.get('/api/debug/files', async (req, res) => {
    try {
        const allFiles = await fs.readdir('.');
        res.json({
            success: true,
            files: allFiles,
            current_directory: process.cwd()
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'favicon.svg'));
});

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

app.use((err, req, res, next) => {
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Initialize default files
function initializeDefaultFiles() {
    try {
        // Create default services config if it doesn't exist
        if (!fsSync.existsSync(CONFIG_FILE)) {
            fsSync.writeFileSync(CONFIG_FILE, JSON.stringify({
                services: DEFAULT_SERVICES,
                last_updated: new Date().toISOString()
            }, null, 2));
            console.log(`Created default config file: ${CONFIG_FILE}`);
        }
        
        // Create default tabs config if it doesn't exist
        if (!fsSync.existsSync(TABS_CONFIG_FILE)) {
            fsSync.writeFileSync(TABS_CONFIG_FILE, JSON.stringify({
                tabs: DEFAULT_TABS,
                last_updated: new Date().toISOString()
            }, null, 2));
            console.log(`Created default tabs config: ${TABS_CONFIG_FILE}`);
        }
        
        // Create default IP whitelist if it doesn't exist
        if (!fsSync.existsSync(IP_WHITELIST_FILE)) {
            fsSync.writeFileSync(IP_WHITELIST_FILE, JSON.stringify({
                allowed_ips: DEFAULT_IP_WHITELIST,
                last_updated: new Date().toISOString()
            }, null, 2));
            console.log(`Created default IP whitelist: ${IP_WHITELIST_FILE}`);
        }
        
        return true;
    } catch (e) {
        console.error('Error initializing default files:', e);
        return false;
    }
}

const PORT = process.env.PORT || 80;

// Initialize default files and start server
if (initializeDefaultFiles()) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`IP whitelist: ${ipWhitelist.join(', ')}`);
    });
} else {
    console.error('Failed to initialize server. Exiting.');
    process.exit(1);
}