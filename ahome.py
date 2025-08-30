from flask import Flask, request, jsonify, render_template
import json
import os
from datetime import datetime



    

app = Flask(__name__)

# Configuration
CONFIG_FILE = 'homelab_services.json'
DEFAULT_SERVICES = []

def load_services():
    """Load services from JSON file"""
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r') as f:
                data = json.load(f)
                # Ensure each service has a column property
                services = []
                for service in data.get('services', []):
                    if 'column' not in service:
                        service['column'] = 0
                    services.append(service)
                return services
        else:
            return DEFAULT_SERVICES
    except Exception as e:
        print(f"Error loading services: {e}")
        return DEFAULT_SERVICES

def save_services(services):
    """Save services to JSON file"""
    try:
        # Create backup
        if os.path.exists(CONFIG_FILE):
            backup_file = f"{CONFIG_FILE}.backup.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            os.rename(CONFIG_FILE, backup_file)
            
            # Keep only last 5 backups
            backup_files = sorted([f for f in os.listdir('.') if f.startswith(f"{CONFIG_FILE}.backup.")])
            for backup in backup_files[:-5]:
                os.remove(backup)
        
        # Save new data
        data = {
            'services': services,
            'last_updated': datetime.now().isoformat()
        }
        
        with open(CONFIG_FILE, 'w') as f:
            json.dump(data, f, indent=2)
        return True
    except Exception as e:
        print(f"Error saving services: {e}")
        return False

@app.route('/')
def index():
    return render_template("index.html")

@app.route('/api/services', methods=['GET'])
def get_services():
    """Get all services"""
    try:
        services = load_services()
        return jsonify({
            'success': True,
            'services': services,
            'count': len(services)
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/services', methods=['POST'])
def save_services_endpoint():
    """Save services"""
    try:
        data = request.get_json()
        
        if not data or 'services' not in data:
            return jsonify({
                'success': False,
                'error': 'Invalid request data'
            }), 400
        
        services = data['services']
        
        # Validate services data
        for i, service in enumerate(services):
            required_fields = ['name', 'url']
            for field in required_fields:
                if field not in service or not service[field].strip():
                    return jsonify({
                        'success': False,
                        'error': f'Service {i+1}: {field} is required'
                    }), 400
            
            # Ensure column is set and valid
            if 'column' not in service:
                service['column'] = 0
            else:
                service['column'] = max(0, min(2, int(service['column'])))
            
            # Ensure description exists
            if 'description' not in service:
                service['description'] = ''
        
        success = save_services(services)
        
        if success:
            return jsonify({
                'success': True,
                'message': 'Services saved successfully',
                'count': len(services)
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to save services'
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/services/<int:service_id>', methods=['DELETE'])
def delete_service(service_id):
    """Delete a specific service"""
    try:
        services = load_services()
        
        if service_id < 0 or service_id >= len(services):
            return jsonify({
                'success': False,
                'error': 'Service not found'
            }), 404
        
        deleted_service = services.pop(service_id)
        success = save_services(services)
        
        if success:
            return jsonify({
                'success': True,
                'message': f'Service "{deleted_service["name"]}" deleted successfully'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to delete service'
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/services/reorder', methods=['POST'])
def reorder_services():
    """Reorder services (useful for drag-and-drop operations)"""
    try:
        data = request.get_json()
        
        if not data or 'services' not in data:
            return jsonify({
                'success': False,
                'error': 'Invalid request data'
            }), 400
        
        services = data['services']
        success = save_services(services)
        
        if success:
            return jsonify({
                'success': True,
                'message': 'Services reordered successfully'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to reorder services'
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'config_file': CONFIG_FILE,
        'config_exists': os.path.exists(CONFIG_FILE)
    })

@app.route('/api/backup', methods=['POST'])
def create_backup():
    """Create a manual backup"""
    try:
        if not os.path.exists(CONFIG_FILE):
            return jsonify({
                'success': False,
                'error': 'No configuration file to backup'
            }), 404
        
        backup_name = f"{CONFIG_FILE}.manual.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        with open(CONFIG_FILE, 'r') as src, open(backup_name, 'w') as dst:
            dst.write(src.read())
        
        return jsonify({
            'success': True,
            'message': 'Backup created successfully',
            'backup_file': backup_name
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/backups', methods=['GET'])
def list_backups():
    """List available backups"""
    try:
        backup_files = [f for f in os.listdir('.') if f.startswith(f"{CONFIG_FILE}.")]
        backup_files.sort(reverse=True)  # Most recent first
        
        backups = []
        for backup_file in backup_files:
            stat = os.stat(backup_file)
            backups.append({
                'filename': backup_file,
                'created': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                'size': stat.st_size
            })
        
        return jsonify({
            'success': True,
            'backups': backups
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({
        'success': False,
        'error': 'Endpoint not found'
    }), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({
        'success': False,
        'error': 'Internal server error'
    }), 500

# CORS support for development
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response


# Prevent favicon.ico 404s
@app.route('/favicon.ico')
def favicon():
    return '', 204   # empty response, "No Content"

if __name__ == '__main__':
    # Ensure the config file exists with default structure
    if not os.path.exists(CONFIG_FILE):
        save_services(DEFAULT_SERVICES)

    app.run(host='0.0.0.0', port=80, debug=True)