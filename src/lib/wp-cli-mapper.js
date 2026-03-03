/**
 * Maps WP-CLI commands to PHP code that can be executed via the MCP bridge.
 *
 * The MCP bridge mu-plugin provides a REST endpoint that eval()'s PHP code
 * in the WordPress context. This module translates common WP-CLI commands
 * into equivalent PHP code.
 */

/**
 * Parse a WP-CLI command string into its component parts.
 * @param {string} command - Raw WP-CLI command (with or without 'wp' prefix)
 * @returns {{ subcommand: string, action: string, positional: string[], flags: Record<string, string|boolean> }}
 */
export function parseWpCliCommand(command) {
  // Strip 'wp ' prefix if present
  let cmd = command.trim();
  if (cmd.startsWith('wp ')) {
    cmd = cmd.slice(3);
  }

  // Tokenize respecting quotes
  const tokens = tokenize(cmd);
  const subcommand = tokens[0] || '';
  const action = tokens[1] && !tokens[1].startsWith('--') ? tokens[1] : '';
  const startIdx = action ? 2 : 1;

  const positional = [];
  const flags = {};

  for (let i = startIdx; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith('--')) {
      const eqIdx = token.indexOf('=');
      if (eqIdx !== -1) {
        const key = token.slice(2, eqIdx);
        const val = token.slice(eqIdx + 1).replace(/^['"]|['"]$/g, '');
        flags[key] = val;
      } else if (token.startsWith('--no-')) {
        flags[token.slice(5)] = false;
      } else {
        flags[token.slice(2)] = true;
      }
    } else {
      positional.push(token.replace(/^['"]|['"]$/g, ''));
    }
  }

  return { subcommand, action, positional, flags };
}

/**
 * Tokenize a command string, respecting single and double quotes.
 * @param {string} str
 * @returns {string[]}
 */
function tokenize(str) {
  const tokens = [];
  let current = '';
  let inQuote = null;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Convert a WP-CLI command to PHP code for execution via the MCP bridge.
 * @param {string} command - The WP-CLI command
 * @returns {{ php: string|null, error: string|null }}
 */
export function wpCliToPhp(command) {
  const parsed = parseWpCliCommand(command);
  const { subcommand, action, positional, flags } = parsed;

  const mapper = COMMAND_MAP[subcommand];
  if (!mapper) {
    return {
      php: null,
      error: `WP-CLI subcommand "${subcommand}" is not supported via the bridge. Supported: ${Object.keys(COMMAND_MAP).join(', ')}. For unsupported commands, include them as wp-cli steps in the blueprint.`,
    };
  }

  let actionMapper = mapper[action];
  let effectivePositional = positional;

  if (!actionMapper) {
    // Action not found — fall through to _default, putting the action back into positional
    actionMapper = mapper['_default'];
    if (action) {
      effectivePositional = [action, ...positional];
    }
  }

  if (!actionMapper) {
    return {
      php: null,
      error: `WP-CLI action "${subcommand} ${action}" is not supported. Available actions for "${subcommand}": ${Object.keys(mapper).filter((k) => k !== '_default').join(', ')}.`,
    };
  }

  try {
    const php = actionMapper(effectivePositional, flags);
    return { php, error: null };
  } catch (err) {
    return { php: null, error: err.message };
  }
}

/**
 * Escape a PHP string value.
 */
function phpEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const COMMAND_MAP = {
  option: {
    get: (positional) => {
      const key = positional[0];
      if (!key) throw new Error('Usage: wp option get <key>');
      return `echo get_option('${phpEscape(key)}');`;
    },
    update: (positional) => {
      const key = positional[0];
      const value = positional[1];
      if (!key || value === undefined) throw new Error('Usage: wp option update <key> <value>');
      return `update_option('${phpEscape(key)}', '${phpEscape(value)}'); echo 'Success: Updated option "${phpEscape(key)}".';`;
    },
    add: (positional) => {
      const key = positional[0];
      const value = positional[1];
      if (!key || value === undefined) throw new Error('Usage: wp option add <key> <value>');
      return `$added = add_option('${phpEscape(key)}', '${phpEscape(value)}'); echo $added ? 'Success: Added option.' : 'Error: Option already exists.';`;
    },
    delete: (positional) => {
      const key = positional[0];
      if (!key) throw new Error('Usage: wp option delete <key>');
      return `$deleted = delete_option('${phpEscape(key)}'); echo $deleted ? 'Success: Deleted option.' : 'Error: Option not found.';`;
    },
    list: (_positional, flags) => {
      const search = flags.search ? `AND option_name LIKE '%${phpEscape(flags.search)}%'` : '';
      return `global $wpdb;
$options = $wpdb->get_results("SELECT option_name, LEFT(option_value, 200) as option_value FROM {$wpdb->options} WHERE 1=1 ${search} ORDER BY option_name LIMIT 100");
${flags.format === 'json' ? 'echo json_encode($options);' : `
foreach ($options as $o) {
    echo $o->option_name . "\\t" . substr($o->option_value, 0, 80) . "\\n";
}`}`;
    },
  },

  post: {
    list: (_positional, flags) => {
      const args = ["'numberposts' => " + (flags['posts_per_page'] || flags.number || 20)];
      if (flags.post_type) args.push(`'post_type' => '${phpEscape(flags.post_type)}'`);
      if (flags.post_status) args.push(`'post_status' => '${phpEscape(flags.post_status)}'`);
      else args.push("'post_status' => 'any'");
      return `$posts = get_posts([${args.join(', ')}]);
$result = array_map(function($p) {
    return ['ID' => $p->ID, 'post_title' => $p->post_title, 'post_status' => $p->post_status, 'post_type' => $p->post_type, 'post_date' => $p->post_date];
}, $posts);
${flags.format === 'json' ? 'echo json_encode($result);' : `
echo str_pad('ID', 6) . str_pad('Title', 40) . str_pad('Status', 12) . str_pad('Type', 15) . "Date\\n";
echo str_repeat('-', 90) . "\\n";
foreach ($result as $r) {
    echo str_pad($r['ID'], 6) . str_pad(substr($r['post_title'], 0, 38), 40) . str_pad($r['post_status'], 12) . str_pad($r['post_type'], 15) . $r['post_date'] . "\\n";
}`}`;
    },
    create: (_positional, flags) => {
      const args = [];
      if (flags.post_title) args.push(`'post_title' => '${phpEscape(flags.post_title)}'`);
      if (flags.post_content) args.push(`'post_content' => '${phpEscape(flags.post_content)}'`);
      if (flags.post_status) args.push(`'post_status' => '${phpEscape(flags.post_status)}'`);
      else args.push("'post_status' => 'publish'");
      if (flags.post_type) args.push(`'post_type' => '${phpEscape(flags.post_type)}'`);
      if (flags.post_excerpt) args.push(`'post_excerpt' => '${phpEscape(flags.post_excerpt)}'`);
      if (flags.post_author) args.push(`'post_author' => ${parseInt(flags.post_author, 10) || 1}`);
      return `$id = wp_insert_post([${args.join(', ')}]);
if (is_wp_error($id)) { echo 'Error: ' . $id->get_error_message(); } else { echo 'Success: Created post ' . $id . '.'; }`;
    },
    get: (positional, flags) => {
      const id = positional[0];
      if (!id) throw new Error('Usage: wp post get <id>');
      return `$p = get_post(${parseInt(id, 10)});
if (!$p) { echo 'Error: Post not found.'; } else {
${flags.format === 'json' ? 'echo json_encode($p);' : `
echo "ID: " . $p->ID . "\\n";
echo "Title: " . $p->post_title . "\\n";
echo "Status: " . $p->post_status . "\\n";
echo "Type: " . $p->post_type . "\\n";
echo "Date: " . $p->post_date . "\\n";
echo "Content:\\n" . $p->post_content . "\\n";`}
}`;
    },
    update: (positional, flags) => {
      const id = positional[0];
      if (!id) throw new Error('Usage: wp post update <id> [--post_title=...] [--post_content=...]');
      const args = [`'ID' => ${parseInt(id, 10)}`];
      for (const [key, val] of Object.entries(flags)) {
        if (key.startsWith('post_') || key === 'menu_order') {
          args.push(`'${phpEscape(key)}' => '${phpEscape(val)}'`);
        }
      }
      return `$id = wp_update_post([${args.join(', ')}]);
if (is_wp_error($id)) { echo 'Error: ' . $id->get_error_message(); } else { echo 'Success: Updated post ' . $id . '.'; }`;
    },
    delete: (positional, flags) => {
      const id = positional[0];
      if (!id) throw new Error('Usage: wp post delete <id>');
      const force = flags.force ? 'true' : 'false';
      return `$result = wp_delete_post(${parseInt(id, 10)}, ${force});
echo $result ? 'Success: Deleted post ${id}.' : 'Error: Could not delete post.';`;
    },
  },

  plugin: {
    list: (_positional, flags) => {
      return `if (!function_exists('get_plugins')) { require_once ABSPATH . 'wp-admin/includes/plugin.php'; }
$plugins = get_plugins();
$active = get_option('active_plugins', []);
$result = [];
foreach ($plugins as $path => $data) {
    $result[] = ['name' => $data['Name'], 'status' => in_array($path, $active) ? 'active' : 'inactive', 'version' => $data['Version'], 'file' => $path];
}
${flags.format === 'json' ? 'echo json_encode($result);' : `
echo str_pad('Name', 35) . str_pad('Status', 12) . str_pad('Version', 10) . "File\\n";
echo str_repeat('-', 80) . "\\n";
foreach ($result as $p) {
    echo str_pad(substr($p['name'], 0, 33), 35) . str_pad($p['status'], 12) . str_pad($p['version'], 10) . $p['file'] . "\\n";
}`}`;
    },
    activate: (positional) => {
      const slug = positional[0];
      if (!slug) throw new Error('Usage: wp plugin activate <plugin>');
      return `if (!function_exists('activate_plugin')) { require_once ABSPATH . 'wp-admin/includes/plugin.php'; }
$input = '${phpEscape(slug)}';
$plugins = get_plugins();
$plugin_file = null;
if (isset($plugins[$input])) {
    $plugin_file = $input;
} else {
    foreach ($plugins as $file => $data) {
        if (strpos($file, $input . '/') === 0 || $data['Name'] === $input) {
            $plugin_file = $file;
            break;
        }
    }
}
if (!$plugin_file) {
    echo 'Error: Plugin "' . $input . '" not found.';
} else {
    $result = activate_plugin($plugin_file);
    if (is_wp_error($result)) { echo 'Error: ' . $result->get_error_message(); } else { echo 'Success: Plugin activated.'; }
}`;
    },
    deactivate: (positional) => {
      const slug = positional[0];
      if (!slug) throw new Error('Usage: wp plugin deactivate <plugin>');
      return `if (!function_exists('deactivate_plugins')) { require_once ABSPATH . 'wp-admin/includes/plugin.php'; }
$input = '${phpEscape(slug)}';
$plugins = get_plugins();
$plugin_file = null;
if (isset($plugins[$input])) {
    $plugin_file = $input;
} else {
    foreach ($plugins as $file => $data) {
        if (strpos($file, $input . '/') === 0 || $data['Name'] === $input) {
            $plugin_file = $file;
            break;
        }
    }
}
if (!$plugin_file) {
    echo 'Error: Plugin "' . $input . '" not found.';
} else {
    deactivate_plugins($plugin_file);
    echo 'Success: Plugin deactivated.';
}`;
    },
  },

  theme: {
    list: (_positional, flags) => {
      return `$themes = wp_get_themes();
$current = get_stylesheet();
$result = [];
foreach ($themes as $slug => $theme) {
    $result[] = ['name' => $theme->get('Name'), 'status' => ($slug === $current ? 'active' : 'inactive'), 'version' => $theme->get('Version'), 'slug' => $slug];
}
${flags.format === 'json' ? 'echo json_encode($result);' : `
echo str_pad('Name', 30) . str_pad('Status', 10) . str_pad('Version', 10) . "Slug\\n";
echo str_repeat('-', 60) . "\\n";
foreach ($result as $t) {
    echo str_pad(substr($t['name'], 0, 28), 30) . str_pad($t['status'], 10) . str_pad($t['version'], 10) . $t['slug'] . "\\n";
}`}`;
    },
    activate: (positional) => {
      const slug = positional[0];
      if (!slug) throw new Error('Usage: wp theme activate <theme-slug>');
      return `switch_theme('${phpEscape(slug)}');
echo 'Success: Switched to theme "${phpEscape(slug)}".';`;
    },
  },

  user: {
    list: (_positional, flags) => {
      const role = flags.role ? `'role' => '${phpEscape(flags.role)}',` : '';
      return `$users = get_users([${role} 'number' => ${flags.number || 100}]);
$result = array_map(function($u) {
    return ['ID' => $u->ID, 'user_login' => $u->user_login, 'user_email' => $u->user_email, 'roles' => implode(',', $u->roles), 'display_name' => $u->display_name];
}, $users);
${flags.format === 'json' ? 'echo json_encode($result);' : `
echo str_pad('ID', 6) . str_pad('Login', 20) . str_pad('Email', 30) . str_pad('Role', 15) . "Name\\n";
echo str_repeat('-', 80) . "\\n";
foreach ($result as $u) {
    echo str_pad($u['ID'], 6) . str_pad($u['user_login'], 20) . str_pad(substr($u['user_email'], 0, 28), 30) . str_pad($u['roles'], 15) . $u['display_name'] . "\\n";
}`}`;
    },
    create: (positional, flags) => {
      const login = positional[0];
      const email = positional[1];
      if (!login || !email) throw new Error('Usage: wp user create <login> <email> [--role=...] [--user_pass=...]');
      const role = flags.role || 'subscriber';
      const pass = flags.user_pass || 'password';
      return `$id = wp_create_user('${phpEscape(login)}', '${phpEscape(pass)}', '${phpEscape(email)}');
if (is_wp_error($id)) { echo 'Error: ' . $id->get_error_message(); } else {
    $u = new WP_User($id);
    $u->set_role('${phpEscape(role)}');
    echo 'Success: Created user ' . $id . '.';
}`;
    },
    get: (positional, flags) => {
      const id = positional[0];
      if (!id) throw new Error('Usage: wp user get <id>');
      return `$u = get_user_by('ID', ${parseInt(id, 10)});
if (!$u) { echo 'Error: User not found.'; } else {
${flags.format === 'json' ? 'echo json_encode(["ID" => $u->ID, "user_login" => $u->user_login, "user_email" => $u->user_email, "roles" => $u->roles, "display_name" => $u->display_name]);' : `
echo "ID: " . $u->ID . "\\n";
echo "Login: " . $u->user_login . "\\n";
echo "Email: " . $u->user_email . "\\n";
echo "Role: " . implode(', ', $u->roles) . "\\n";
echo "Display Name: " . $u->display_name . "\\n";`}
}`;
    },
  },

  site: {
    _default: () => {
      return `echo "URL: " . home_url() . "\\n";
echo "Title: " . get_bloginfo('name') . "\\n";
echo "Description: " . get_bloginfo('description') . "\\n";
echo "WP Version: " . get_bloginfo('version') . "\\n";
echo "PHP Version: " . PHP_VERSION . "\\n";
echo "Theme: " . get_stylesheet() . "\\n";
echo "Admin Email: " . get_option('admin_email') . "\\n";
echo "Language: " . get_locale() . "\\n";
echo "Timezone: " . get_option('timezone_string', 'UTC') . "\\n";`;
    },
  },

  db: {
    query: (positional) => {
      const sql = positional[0];
      if (!sql) throw new Error('Usage: wp db query "<SQL>"');
      return `global $wpdb;
$result = $wpdb->get_results($wpdb->prepare("${phpEscape(sql)}"));
if ($wpdb->last_error) { echo 'Error: ' . $wpdb->last_error; } else { echo json_encode($result); }`;
    },
  },

  eval: {
    _default: (positional) => {
      const code = positional.join(' ');
      if (!code) throw new Error('Usage: wp eval "<PHP code>"');
      return code;
    },
  },

  'eval-file': {
    _default: () => {
      return null; // Not supported via bridge
    },
  },

  transient: {
    get: (positional) => {
      const key = positional[0];
      if (!key) throw new Error('Usage: wp transient get <key>');
      return `$val = get_transient('${phpEscape(key)}'); echo $val === false ? '(not set)' : (is_scalar($val) ? $val : json_encode($val));`;
    },
    set: (positional) => {
      const key = positional[0];
      const value = positional[1];
      const expiration = positional[2] || '0';
      if (!key || value === undefined) throw new Error('Usage: wp transient set <key> <value> [<expiration>]');
      return `set_transient('${phpEscape(key)}', '${phpEscape(value)}', ${parseInt(expiration, 10)}); echo 'Success: Transient set.';`;
    },
    delete: (positional) => {
      const key = positional[0];
      if (!key) throw new Error('Usage: wp transient delete <key>');
      return `$deleted = delete_transient('${phpEscape(key)}'); echo $deleted ? 'Success: Transient deleted.' : 'Transient not found.';`;
    },
  },

  menu: {
    list: (_positional, flags) => {
      return `$menus = wp_get_nav_menus();
$result = array_map(function($m) { return ['term_id' => $m->term_id, 'name' => $m->name, 'slug' => $m->slug, 'count' => $m->count]; }, $menus);
${flags.format === 'json' ? 'echo json_encode($result);' : `
foreach ($result as $m) { echo $m['term_id'] . "\\t" . $m['name'] . "\\t(" . $m['count'] . " items)\\n"; }`}`;
    },
    create: (positional) => {
      const name = positional[0];
      if (!name) throw new Error('Usage: wp menu create "<name>"');
      return `$id = wp_create_nav_menu('${phpEscape(name)}');
if (is_wp_error($id)) { echo 'Error: ' . $id->get_error_message(); } else { echo 'Success: Created menu ' . $id . '.'; }`;
    },
  },

  search_replace: {
    _default: (positional) => {
      const search = positional[0];
      const replace = positional[1];
      if (!search || replace === undefined) throw new Error('Usage: wp search-replace <search> <replace>');
      return `global $wpdb;
$tables = $wpdb->get_col("SHOW TABLES");
$total = 0;
foreach ($tables as $table) {
    $cols = $wpdb->get_results("SHOW COLUMNS FROM \`$table\`");
    foreach ($cols as $col) {
        $count = $wpdb->query($wpdb->prepare("UPDATE \`$table\` SET \`{$col->Field}\` = REPLACE(\`{$col->Field}\`, %s, %s)", '${phpEscape(search)}', '${phpEscape(replace)}'));
        $total += $count;
    }
}
echo "Success: Made $total replacements.";`;
    },
  },

  'search-replace': {
    _default: (positional) => COMMAND_MAP.search_replace._default(positional),
  },

  wc: {
    product: {
      _default: () => null,
    },
    _default: (_positional, _flags) => {
      return null; // WooCommerce CLI has complex syntax; suggest blueprint steps
    },
  },
};

// Handle 'wc' subcommands specially since they're nested (wc product create, etc.)
COMMAND_MAP.wc = {
  _default: () => {
    return null;
  },
};
