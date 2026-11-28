const male = [
  'Aaron', 'Adam', 'Adrian', 'Aiden', 'Alan', 'Alejandro', 'Alex', 'Amir', 'Andre',
  'Andrew', 'Anthony', 'Antonio', 'Arthur', 'Austin', 'Benjamin', 'Blake', 'Bradley', 'Brandon',
  'Brian', 'Bryce', 'Caleb', 'Cameron', 'Carlos', 'Carter', 'Charles', 'Christian', 'Christopher',
  'Cole', 'Connor', 'Daniel', 'Dante', 'Darius', 'David', 'Derek', 'Diego', 'Dominic',
  'Dylan', 'Elijah', 'Eric', 'Ethan', 'Evan', 'Felix', 'Gabriel', 'Garrett', 'Gavin',
  'Henry', 'Hugo', 'Ian', 'Ibrahim', 'Isaac', 'Isaiah', 'Ivan', 'Jack', 'Jackson',
  'Jacob', 'James', 'Jamal', 'Jared', 'Jason', 'Javier', 'Jayden', 'Jeremy', 'Jesse',
  'Joel', 'John', 'Jonah', 'Jordan', 'Jose', 'Joseph', 'Joshua', 'Juan', 'Julian',
  'Justin', 'Kai', 'Kevin', 'Kyle', 'Leo', 'Liam', 'Logan', 'Lucas', 'Luis',
  'Malik', 'Marcus', 'Mason', 'Mateo', 'Matthew', 'Max', 'Michael', 'Miguel', 'Miles',
  'Nathan', 'Nicholas', 'Noah', 'Nolan', 'Omar', 'Oscar', 'Owen', 'Rafael', 'Ravi',
  'Ryan', 'Samuel', 'Sean', 'Sebastian', 'Seth', 'Simon', 'Theo', 'Thomas', 'Trent',
  'Tyler', 'Victor', 'Vincent', 'Wesley', 'Xavier', 'Zachary',
];

const female = [
  'Abigail', 'Addison', 'Adriana', 'Aisha', 'Alexandra', 'Alexis', 'Alice', 'Alyssa', 'Amanda',
  'Amber', 'Amelia', 'Ana', 'Andrea', 'Angela', 'Anika', 'Anna', 'Ariana', 'Ashley',
  'Audrey', 'Ava', 'Bailey', 'Brianna', 'Brooke', 'Camila', 'Carmen', 'Caroline', 'Cassandra',
  'Charlotte', 'Chloe', 'Christina', 'Claire', 'Danielle', 'Delilah', 'Diana', 'Eden', 'Elena',
  'Elise', 'Elizabeth', 'Ella', 'Emily', 'Emma', 'Erica', 'Eva', 'Evelyn', 'Fatima',
  'Gabriela', 'Grace', 'Hailey', 'Hannah', 'Harper', 'Hazel', 'Isabel', 'Isabella', 'Ivy',
  'Jade', 'Jasmine', 'Jenna', 'Jennifer', 'Jessica', 'Jordan', 'Julia', 'Kaitlyn', 'Kara',
  'Kayla', 'Kelsey', 'Kiara', 'Kylie', 'Layla', 'Leah', 'Lily', 'Lucia', 'Lucy',
  'Madison', 'Maya', 'Megan', 'Mia', 'Michelle', 'Morgan', 'Naomi', 'Natalie', 'Nicole',
  'Nina', 'Nora', 'Olivia', 'Paige', 'Peyton', 'Priya', 'Rachel', 'Reese', 'Riley',
  'Ruby', 'Samantha', 'Sara', 'Savannah', 'Serena', 'Sofia', 'Sophia', 'Stephanie', 'Sydney',
  'Taylor', 'Valeria', 'Vanessa', 'Veronica', 'Victoria', 'Violet', 'Vivian', 'Yasmin', 'Zoe',
];

const last = [
  'Adams', 'Ahmed', 'Alexander', 'Allen', 'Alvarez', 'Anderson', 'Bailey', 'Baker', 'Barnes',
  'Bell', 'Bennett', 'Brooks', 'Brown', 'Bryant', 'Butler', 'Campbell', 'Carter', 'Castillo',
  'Chang', 'Chavez', 'Chen', 'Clark', 'Cohen', 'Cole', 'Collins', 'Cooper', 'Cox',
  'Cruz', 'Daniels', 'Davis', 'Diaz', 'Dixon', 'Douglas', 'Edwards', 'Ellis', 'Evans',
  'Fernandez', 'Fisher', 'Flores', 'Ford', 'Foster', 'Garcia', 'Gardner', 'Gomez', 'Gonzalez',
  'Gordon', 'Graham', 'Grant', 'Gray', 'Green', 'Griffin', 'Gupta', 'Hall', 'Harris',
  'Hayes', 'Hernandez', 'Hill', 'Howard', 'Huang', 'Hughes', 'Ibrahim', 'Jackson', 'James',
  'Jenkins', 'Johnson', 'Jones', 'Kelly', 'Khan', 'Kim', 'King', 'Kumar', 'Lee',
  'Lewis', 'Lin', 'Long', 'Lopez', 'Marshall', 'Martin', 'Martinez', 'Mason', 'Mendoza',
  'Miller', 'Mitchell', 'Moore', 'Morales', 'Morgan', 'Morris', 'Murphy', 'Myers', 'Nelson',
  'Nguyen', 'Ortiz', 'Owens', 'Park', 'Parker', 'Patel', 'Perez', 'Perry', 'Peterson',
  'Phillips', 'Powell', 'Price', 'Ramirez', 'Ramos', 'Reed', 'Reyes', 'Reynolds', 'Rivera',
  'Roberts', 'Robinson', 'Rodriguez', 'Rogers', 'Ross', 'Ruiz', 'Russell', 'Sanchez', 'Sanders',
  'Santos', 'Scott', 'Shah', 'Singh', 'Smith', 'Spencer', 'Stewart', 'Sullivan', 'Tan',
  'Taylor', 'Thomas', 'Thompson', 'Torres', 'Tran', 'Turner', 'Vargas', 'Vasquez', 'Walker',
  'Wang', 'Ward', 'Washington', 'Watson', 'Weaver', 'West', 'White', 'Williams', 'Wilson',
  'Wong', 'Wood', 'Wright', 'Yang', 'Young', 'Zhang',
];

export const NAME_POOL = { male, female, last, first: [...new Set([...male, ...female])] };
