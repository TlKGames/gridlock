const male = [
  'Abel', 'Abraham', 'Albert', 'Alfred', 'Amos', 'Andrew', 'Asa', 'August', 'Augustus',
  'Benjamin', 'Caleb', 'Calvin', 'Charles', 'Chester', 'Clarence', 'Claude', 'Cyrus', 'Daniel',
  'David', 'Edgar', 'Edmund', 'Edward', 'Elias', 'Elijah', 'Elisha', 'Emanuel', 'Ephraim',
  'Ernest', 'Eugene', 'Everett', 'Felix', 'Francis', 'Frank', 'Frederick', 'George', 'Gideon',
  'Gilbert', 'Henry', 'Hiram', 'Homer', 'Horace', 'Hugh', 'Isaac', 'Isaiah', 'Jacob',
  'James', 'Jasper', 'Jesse', 'Joel', 'John', 'Jonas', 'Jonathan', 'Joseph', 'Josiah',
  'Levi', 'Lewis', 'Louis', 'Luther', 'Martin', 'Matthew', 'Moses', 'Nathan', 'Nathaniel',
  'Oliver', 'Oscar', 'Patrick', 'Peter', 'Philip', 'Ralph', 'Reuben', 'Rufus', 'Samuel',
  'Silas', 'Simon', 'Solomon', 'Stephen', 'Theodore', 'Thomas', 'Tobias', 'Victor', 'Walter',
  'Warren', 'Wesley', 'William', 'Willis', 'Wyatt',
];

const female = [
  'Abigail', 'Ada', 'Adeline', 'Agnes', 'Alice', 'Alma', 'Amelia', 'Anna', 'Anne',
  'Augusta', 'Barbara', 'Belle', 'Bertha', 'Caroline', 'Carrie', 'Catherine', 'Cecilia', 'Charlotte',
  'Clara', 'Cora', 'Cornelia', 'Daisy', 'Delia', 'Dora', 'Dorothea', 'Edith', 'Effie',
  'Eleanor', 'Eliza', 'Elizabeth', 'Ella', 'Ellen', 'Elsie', 'Emma', 'Esther', 'Etta',
  'Eva', 'Evelyn', 'Fannie', 'Flora', 'Florence', 'Frances', 'Georgia', 'Grace', 'Harriet',
  'Hattie', 'Helen', 'Henrietta', 'Ida', 'Irene', 'Jane', 'Jennie', 'Josephine', 'Julia',
  'Kate', 'Laura', 'Lena', 'Leona', 'Lillian', 'Lottie', 'Louisa', 'Lucy', 'Lydia',
  'Mabel', 'Mae', 'Margaret', 'Martha', 'Mary', 'Matilda', 'Mattie', 'Maude', 'May',
  'Minnie', 'Miriam', 'Mollie', 'Nancy', 'Nellie', 'Nora', 'Olive', 'Pearl', 'Phoebe',
  'Rachel', 'Rebecca', 'Rosa', 'Rose', 'Ruth', 'Sarah', 'Sophia', 'Stella', 'Susan',
  'Susanna', 'Viola', 'Virginia',
];

const last = [
  'Abbott', 'Adams', 'Allen', 'Archer', 'Ashby', 'Baker', 'Barnes', 'Barrett', 'Barton',
  'Beck', 'Bell', 'Bennett', 'Bishop', 'Black', 'Boone', 'Bowman', 'Boyd', 'Brady',
  'Brooks', 'Brown', 'Burke', 'Burns', 'Butler', 'Caldwell', 'Campbell', 'Carter', 'Chase',
  'Clark', 'Cole', 'Coleman', 'Collins', 'Cooper', 'Cox', 'Crawford', 'Cross', 'Dawson',
  'Dixon', 'Doyle', 'Dunn', 'Edwards', 'Ellis', 'Evans', 'Fisher', 'Flores', 'Ford',
  'Foster', 'Freeman', 'Garcia', 'Gardner', 'Grant', 'Gray', 'Green', 'Griffin', 'Hall',
  'Harper', 'Harris', 'Hart', 'Hayes', 'Hill', 'Holt', 'Howard', 'Hughes', 'Jackson',
  'James', 'Jensen', 'Johnson', 'Jones', 'Kelly', 'King', 'Lane', 'Lawson', 'Lee',
  'Lewis', 'Long', 'Lopez', 'Martin', 'Mason', 'McCoy', 'Meyer', 'Miller', 'Mills',
  'Moore', 'Morales', 'Morgan', 'Morris', 'Murphy', 'Nelson', 'Ortiz', 'Owens', 'Palmer',
  'Parker', 'Perez', 'Perry', 'Pierce', 'Pike', 'Porter', 'Price', 'Quinn', 'Reed',
  'Reyes', 'Rhodes', 'Riley', 'Ross', 'Ruiz', 'Russell', 'Scott', 'Shaw', 'Sherman',
  'Silva', 'Smith', 'Spencer', 'Stokes', 'Stone', 'Taylor', 'Thomas', 'Turner', 'Vance',
  'Walker', 'Ward', 'Warren', 'Watson', 'Webb', 'Wells', 'West', 'Wheeler', 'White',
  'Wilcox', 'Wilson', 'Wood', 'Wright', 'Young',
];

export const NAME_POOL = { male, female, last, first: [...new Set([...male, ...female])] };
