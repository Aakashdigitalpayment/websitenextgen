<?php
/**
 * Build the COMPLETE schema a production PHP install can hold (db/legacy/php-runtime-schema.sql).
 * The PHP app creates and alters tables at runtime, so install.sql alone is not the real source schema.
 *
 * Steps (never against a live site — use a scratch copy and an empty MariaDB/MySQL database):
 *   1. copy the PHP site to a scratch folder; write includes/database.local.php pointing at an empty database
 *   2. mysql <db> < database/install.sql
 *   3. php scripts/legacy/inventory-php-schema.php /path/to/scratch-copy
 *   4. mysqldump --no-data --skip-comments --skip-add-drop-table --compact <db> | sed -E 's/ AUTO_INCREMENT=[0-9]+//'
 *        >> db/legacy/php-runtime-schema.sql   (keep the header comment)
 *
 * It runs every ensure*() function of the PHP code base, then every literal CREATE/ALTER TABLE and safeAddColumn()
 * call found anywhere in the PHP files, then the "foreach ($cols as $col => $def) safeAddColumn(...)" loops of the
 * admin pages. Errors for things that already exist are expected and ignored.
 */
if (PHP_SAPI !== 'cli' || empty($argv[1]) || !is_file($argv[1] . '/includes/config.php')) {
    fwrite(STDERR, "usage: php inventory-php-schema.php <php site copy>\n");
    exit(2);
}
$ROOT = realpath($argv[1]);
$_SERVER += ['HTTP_HOST' => 'localhost', 'REQUEST_URI' => '/', 'REMOTE_ADDR' => '127.0.0.1', 'SCRIPT_NAME' => '/index.php'];
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE & ~E_WARNING);
@unlink($ROOT . '/.schema.lock');
chdir($ROOT);
ob_start();
require_once $ROOT . '/includes/config.php';
foreach (glob($ROOT . '/includes/*.php') as $f) {
    if (preg_match('/(header|footer|database\.|config\.php|boot-shared|kyc-public-form|member-marketplace-public-page|satisfaction-widget|member-prefill-block|information-room-viewer)/', $f)) continue;
    try { require_once $f; } catch (Throwable $e) { fwrite(STDERR, "include $f: " . $e->getMessage() . "\n"); }
}
try { require_once $ROOT . '/admin/includes/ensure-admin-tables.php'; } catch (Throwable $e) { fwrite(STDERR, $e->getMessage() . "\n"); }
$db = getDB();

// 1. every ensure*() function (twice: some depend on tables another one creates)
$fns = array_filter(get_defined_functions()['user'], fn($f) => preg_match('/^(ensure|coop_ensure|coop_perm_ensure|coopipensure|membershipensure|coop_monthly_saving_ensure|coop_admin_ensure|gallerymigrate|healmigrated)/i', $f));
for ($pass = 0; $pass < 2; $pass++) foreach ($fns as $fn) {
    $r = new ReflectionFunction($fn);
    if ($r->getNumberOfRequiredParameters() > 1) continue;
    try { $fn(...($r->getNumberOfParameters() ? [$db] : [])); } catch (Throwable $e) { if ($pass) fwrite(STDERR, "$fn: " . $e->getMessage() . "\n"); }
}
ob_end_clean();

$phpFiles = [];
foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($ROOT, FilesystemIterator::SKIP_DOTS)) as $f) {
    $p = $f->getPathname();
    if (preg_match('/\.php$/', $p) && strpos($p, '/vendor/') === false) $phpFiles[] = $p;
}

// 2. literal DDL strings and safeAddColumn($db, 'table', 'col', 'def') calls anywhere
$ran = 0;
foreach ($phpFiles as $p) {
    $src = file_get_contents($p);
    if (!preg_match('/CREATE TABLE|ALTER TABLE|safeAddColumn|addCol/i', $src)) continue;
    $toks = token_get_all($src);
    $n = count($toks);
    for ($i = 0; $i < $n; $i++) {
        $t = $toks[$i];
        if (!is_array($t)) continue;
        if ($t[0] === T_CONSTANT_ENCAPSED_STRING) {
            $s = eval('return ' . $t[1] . ';');
            if (preg_match('/^\s*(CREATE TABLE|ALTER TABLE)/i', $s)) { try { $db->exec($s); $ran++; } catch (Throwable $e) {} }
        }
        if (($t[0] === T_STRING || $t[0] === T_VARIABLE) && preg_match('/^\$?(safeAddColumn|addCol)$/', $t[1])) {
            $j = $i + 1;
            while ($j < $n && $toks[$j] !== '(' && is_array($toks[$j]) && $toks[$j][0] === T_WHITESPACE) $j++;
            if ($j >= $n || $toks[$j] !== '(') continue;
            $depth = 0; $args = []; $cur = '';
            for ($k = $j; $k < $n; $k++) {
                $x = $toks[$k]; $tx = is_array($x) ? $x[1] : $x;
                if ($x === '(') { $depth++; if ($depth === 1) continue; }
                if ($x === ')') { $depth--; if ($depth === 0) { $args[] = $cur; break; } }
                if ($x === ',' && $depth === 1) { $args[] = $cur; $cur = ''; continue; }
                $cur .= $tx;
            }
            $args = array_map('trim', $args);
            if (count($args) < 4) continue;
            $vals = [];
            foreach (array_slice($args, 1, 3) as $a) {
                if (!preg_match('/^(\'[^\']*\'|"[^"$]*")(\s*\.\s*(\'[^\']*\'|"[^"$]*"))*$/s', $a)) { $vals = null; break; }
                $vals[] = eval('return ' . $a . ';');
            }
            if ($vals) { try { safeAddColumn($db, $vals[0], $vals[1], $vals[2]); $ran++; } catch (Throwable $e) {} }
        }
    }
}

// 3. foreach ($cols as $col => $def) safeAddColumn($db, 'table', $col, $def) / ALTER TABLE t ADD COLUMN `{$col}` {$def}
foreach ($phpFiles as $p) {
    $src = file_get_contents($p);
    if (!preg_match_all('/foreach\s*\(/', $src, $m, PREG_OFFSET_CAPTURE)) continue;
    foreach ($m[0] as $hit) {
        $off = $hit[1]; $win = substr($src, $off, 900);
        if (!preg_match('/^foreach\s*\(\s*(.+?)\s+as\s+\$(\w+)\s*=>\s*\$(\w+)\s*\)/s', $win, $fm)) continue;
        if (!preg_match('/(?:safeAddColumn\(\s*\$\w+\s*,\s*[\'"`]?(\w+)[\'"`]?\s*,\s*\$' . $fm[2] . '|ALTER TABLE\s+`?(\w+)`?\s+ADD COLUMN\s+`?\{?\$' . $fm[2] . ')/', $win, $tm)) continue;
        $table = $tm[1] ?: ($tm[2] ?? '');
        $expr = trim($fm[1]);
        if ($table === '') continue;
        if ($expr[0] === '$') {
            if (!preg_match_all('/' . preg_quote($expr, '/') . '\s*=\s*\[/', substr($src, 0, $off), $am, PREG_OFFSET_CAPTURE)) continue;
            $last = end($am[0]);
            $rest = substr($src, $last[1] + strlen($last[0]) - 1);
        } elseif ($expr[0] === '[') {
            $rest = substr($win, strpos($win, '['));
        } else continue;
        $d = 0; $e = 0; $L = strlen($rest); $q = null;
        for ($i = 0; $i < $L; $i++) {
            $c = $rest[$i];
            if ($q) { if ($c === '\\') { $i++; continue; } if ($c === $q) $q = null; continue; }
            if ($c === "'" || $c === '"') { $q = $c; continue; }
            if ($c === '[') $d++;
            if ($c === ']') { $d--; if (!$d) { $e = $i; break; } }
        }
        $lit = preg_replace('/\$\w+(->\w+|\[[^\]]*\])*/', '""', substr($rest, 0, $e + 1));
        try { $arr = @eval('return ' . $lit . ';'); } catch (Throwable $ex) { continue; }
        if (!is_array($arr)) continue;
        foreach ($arr as $c => $def) {
            if (is_array($def)) $def = $def[1] ?? ($def[0] ?? null);
            if (!is_string($c) || !is_string($def)) continue;
            try { safeAddColumn($db, $table, $c, $def); $ran++; } catch (Throwable $ex) {}
        }
    }
}
// 4. scripts/pii-encrypt.php widens the PII columns to VARCHAR(512) before encrypting (installs with PII_ENC_KEY)
if (function_exists('pii_columns')) {
    foreach (pii_columns() as $t => $cs) foreach ($cs as $c) {
        $st = $db->prepare('SELECT IS_NULLABLE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?');
        $st->execute([$t, $c]);
        $nullable = $st->fetchColumn();
        if ($nullable === false) continue;
        try { $db->exec("ALTER TABLE `$t` MODIFY `$c` VARCHAR(512) " . ($nullable === 'YES' ? 'NULL' : "NOT NULL DEFAULT ''")); $ran++; } catch (Throwable $e) {}
    }
}
$tables = (int)$db->query('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()')->fetchColumn();
$cols = (int)$db->query('SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE()')->fetchColumn();
echo "ensure functions: " . count($fns) . ", DDL statements run: $ran → $tables tables, $cols columns\n";
